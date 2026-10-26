import { parseGuide, type Guide } from './guide.ts';
import { askModel, DEFAULT_MODEL, type Message, type ModelBinding } from './model.ts';
import { csvCell, equalSecret, opaqueKey, sign, verify } from './security.ts';

export interface Env {
  DB: D1Database;
  AI: ModelBinding;
  ASSETS: { fetch(request: Request): Promise<Response> };
  SITTER_CODE: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  SHARE_TOKEN: string;
  AI_MODEL?: string;
  ENVIRONMENT?: string;
  DAILY_LIMIT?: string;
}
interface Session { kind: 'session'; role: 'sitter' | 'admin'; id: string; exp: number; grant?: string }
interface Receipt { kind: 'receipt'; question: string; answer: string; type: string; version: string; model: string; exp: number }
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers });
const seconds = () => Math.floor(Date.now() / 1000);
const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

function cookieName(request: Request) { return new URL(request.url).protocol === 'https:' ? '__Host-mozz_session' : 'mozz_local_session'; }
function cookie(request: Request, token: string, age: number): string { return `${cookieName(request)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`; }

async function session(request: Request, env: Env): Promise<Session | null> {
  const token = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName(request) + '='))?.slice(cookieName(request).length + 1);
  const value = await verify<Session>(token, env.SESSION_SECRET);
  if (value?.kind !== 'session' || !['admin', 'sitter'].includes(value.role) || value.exp <= seconds()) return null;
  if (value.role === 'sitter' && value.grant !== await opaqueKey(await shareToken(env), env.SESSION_SECRET)) return null;
  return value;
}

async function shareToken(env: Env): Promise<string> {
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').bind('share_token', env.SHARE_TOKEN).run();
  const value = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('share_token').first<{ value: string }>();
  if (!value) throw new HttpError(503, 'Sharing is awaiting setup.');
  return value.value;
}

function configured(env: Env): boolean { return !!env.DB && env.SITTER_CODE?.length >= 6 && env.ADMIN_PASSWORD?.length >= 16 && env.SESSION_SECRET?.length >= 32 && env.SHARE_TOKEN?.length >= 16 && env.SITTER_CODE !== env.ADMIN_PASSWORD; }

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, 'Use JSON for this request.');
  if (Number(request.headers.get('Content-Length')) > 30000) throw new HttpError(413, 'This request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A request body is required.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 30000) { await reader.cancel(); throw new HttpError(413, 'This request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { const parsed = JSON.parse(new TextDecoder().decode(bytes)); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); return parsed; }
  catch { throw new HttpError(400, 'This request is not valid JSON.'); }
}

async function limit(env: Env, key: string, max: number, period: number): Promise<void> {
  const now = seconds(); const window = Math.floor(now / period) * period;
  const result = await env.DB.prepare(`INSERT INTO rate_limits (key, window, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count`).bind(key, window).first<{ count: number }>();
  if (!result || result.count > max) throw new HttpError(429, 'This request limit has been reached. Please try again later. The care guide is still available.');
}

async function getGuide(env: Env): Promise<Guide> {
  const row = await env.DB.prepare('SELECT version, content FROM guides WHERE id=?').bind('mozz').first<{ version: string; content: string }>();
  if (!row) throw new HttpError(503, 'The care guide is not configured yet.');
  return parseGuide(row.content, row.version);
}

function validMessages(value: unknown): Message[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) throw new HttpError(400, 'Send a question with up to six previous messages.');
  const messages: Message[] = value.map((item: any) => {
    if (!item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > 2000) throw new HttpError(400, 'A message is invalid or too long.');
    return { role: item.role, content: item.content.trim() };
  });
  if (messages.at(-1)?.role !== 'user' || messages.reduce((sum, m) => sum + m.content.length, 0) > 9000) throw new HttpError(400, 'Start a new chat or shorten this question.');
  return messages;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), path = url.pathname;
  if (request.method === 'GET' && path === '/api/health') return json({ status: configured(env) ? 'configured' : 'setup-required' }, configured(env) ? 200 : 503);
  if (path.startsWith('/api/')) {
    if (!configured(env)) throw new HttpError(503, 'The app is awaiting secure setup.');
    if (new URL(request.url).protocol !== 'https:' && env.ENVIRONMENT !== 'development' && env.ENVIRONMENT !== 'test') throw new HttpError(400, 'HTTPS is required.');
    if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('Origin') !== url.origin) throw new HttpError(403, 'This request must come from this website.');
    if (path === '/api/login' && request.method === 'POST') {
      await env.DB.prepare('DELETE FROM rate_limits WHERE window < ?').bind(seconds() - 86400).run();
      const ip = await opaqueKey(request.headers.get('CF-Connecting-IP') ?? 'local', env.SESSION_SECRET);
      await limit(env, 'login:' + ip, 8, 900);
      const data = await body(request);
      const role = data.role === 'admin' ? 'admin' : 'sitter';
      const password = typeof data.password === 'string' ? data.password : '';
      const currentShare = await shareToken(env);
      const validLink = role === 'admin' || (typeof data.shareToken === 'string' && await equalSecret(data.shareToken, currentShare));
      if (!validLink || !password || password.length > 256 || !await equalSecret(password, role === 'admin' ? env.ADMIN_PASSWORD : env.SITTER_CODE)) throw new HttpError(401, 'The access details did not match. Please check with the person who shared this page.');
      const token = await sign({ kind: 'session', role, id: crypto.randomUUID(), exp: seconds() + 43200, ...(role === 'sitter' ? { grant: await opaqueKey(currentShare, env.SESSION_SECRET) } : {}) }, env.SESSION_SECRET);
      return json({ role }, 200, { 'Set-Cookie': cookie(request, token, 43200) });
    }
    if (path === '/api/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
    const user = await session(request, env);
    if (!user) throw new HttpError(401, 'Please enter your access code to continue.');
    if (path === '/api/session' && request.method === 'GET') return json({ role: user.role });
    if (path.startsWith('/api/admin/')) {
      if (user.role !== 'admin') throw new HttpError(403, 'Owner access is required.');
      if (path === '/api/admin/share' && request.method === 'GET') return json({ url: url.origin + '/s/' + await shareToken(env) });
      if (path === '/api/admin/rotate-link' && request.method === 'POST') {
        const data = await body(request);
        if (data.confirm !== 'rotate-link') throw new HttpError(400, 'Confirm link replacement explicitly.');
        const next = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().slice(0, 8);
        await env.DB.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('share_token', next).run();
        return json({ url: url.origin + '/s/' + next });
      }
      if (path === '/api/admin/feedback' && request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 500').all();
        return json({ items: rows.results, limit: 500 });
      }
      if (path === '/api/admin/export' && request.method === 'GET') {
        const rows = await env.DB.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all<Record<string, unknown>>();
        const keys = ['id', 'created_at', 'category', 'rating', 'comment', 'tester_name', 'question', 'answer', 'answer_type', 'guide_version', 'model'];
        const csv = [keys.map(csvCell).join(','), ...rows.results.map(row => keys.map(key => csvCell(row[key])).join(','))].join('\r\n');
        return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mozz-feedback.csv"' } });
      }
      const match = path.match(/^\/api\/admin\/feedback\/([a-f0-9-]{36})$/);
      if (match && request.method === 'DELETE') { await env.DB.prepare('DELETE FROM feedback WHERE id=?').bind(match[1]).run(); return json({ ok: true }); }
      if (path === '/api/admin/feedback' && request.method === 'DELETE') {
        const data = await body(request); if (data.confirm !== 'delete-all') throw new HttpError(400, 'Confirm deletion explicitly.');
        await env.DB.prepare('DELETE FROM feedback').run(); return json({ ok: true });
      }
      throw new HttpError(404, 'That owner action was not found.');
    }
    if (path === '/api/guide' && request.method === 'GET') return json(await getGuide(env));
    if (path === '/api/chat' && request.method === 'POST') {
      const data = await body(request), messages = validMessages(data.messages);
      await limit(env, 'chat:' + user.id, 12, 3600);
      const ip = await opaqueKey(request.headers.get('CF-Connecting-IP') ?? 'local', env.SESSION_SECRET);
      await limit(env, 'chat-ip:' + ip, 30, 3600);
      await limit(env, 'model-daily', Math.min(100, Math.max(1, Number(env.DAILY_LIMIT) || 30)), 86400);
      const guide = await getGuide(env), model = env.AI_MODEL ?? DEFAULT_MODEL;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const answer = await Promise.race([askModel(env.AI, model, guide, messages), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Timeout')), 45000); })]);
        const receipt = await sign({ kind: 'receipt', question: messages.at(-1)!.content, answer: answer.answer, type: answer.type, version: guide.version, model, exp: seconds() + 86400 }, env.SESSION_SECRET);
        return json({ ...answer, receipt, model, guideVersion: guide.version });
      } catch { throw new HttpError(503, 'The AI could not return a usable answer right now. Please use the care guide or contact an owner. No answer has been substituted.'); }
      finally { if (timeout !== undefined) clearTimeout(timeout); }
    }
    if (path === '/api/feedback' && request.method === 'POST') {
      await limit(env, 'feedback:' + user.id, 30, 3600);
      const data = await body(request);
      const comment = typeof data.comment === 'string' ? data.comment.trim() : '';
      const tester = typeof data.testerName === 'string' ? data.testerName.trim() : '';
      const category = typeof data.category === 'string' ? data.category : 'general';
      if (!['rating', 'bug', 'suggestion', 'general'].includes(category) || comment.length > 3000 || tester.length > 80) throw new HttpError(400, 'Please shorten your feedback.');
      const receipt = typeof data.receipt === 'string' ? await verify<Receipt>(data.receipt, env.SESSION_SECRET) : null;
      if (data.receipt && (!receipt || receipt.kind !== 'receipt' || receipt.exp <= seconds())) throw new HttpError(400, 'That answer has expired. Please ask again before attaching feedback.');
      const rating = data.rating === 'helpful' || data.rating === 'unhelpful' ? data.rating : null;
      if (category === 'rating' && (!receipt || !rating)) throw new HttpError(400, 'Select an answer and a rating.');
      if (!comment && !rating) throw new HttpError(400, 'Please write some feedback.');
      if (rating && !receipt) throw new HttpError(400, 'A rating must refer to an answer.');
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO feedback (id,created_at,category,rating,comment,tester_name,question,answer,answer_type,guide_version,model) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, new Date().toISOString(), category, rating, comment, tester || null, receipt?.question ?? null, receipt?.answer ?? null, receipt?.type ?? null, receipt?.version ?? null, receipt?.model ?? null).run();
      return json({ id, saved: true }, 201);
    }
    throw new HttpError(404, 'That action was not found.');
  }
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'This method is not supported.');
  if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
  if (path === '/admin' || /^\/s\/[A-Za-z0-9_-]{16,128}$/.test(path) || path === '/') {
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  }
  if (['/app.js', '/style.css'].includes(path)) return env.ASSETS.fetch(request);
  throw new HttpError(404, 'This page was not found.');
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  let response: Response;
  try { response = await route(request, env); }
  catch (error) { response = error instanceof HttpError ? json({ error: error.message }, error.status, error.status === 429 ? { 'Retry-After': '900' } : {}) : json({ error: 'Something went wrong. Please try again.' }, 500); }
  const result = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) result.headers.set(name, value);
  return result;
}

export default { fetch: handleRequest };
