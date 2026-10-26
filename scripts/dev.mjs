import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { handleRequest } from '../dist/worker.mjs';

// Local-only test credentials. Deployment never falls back to these values.
export const localSitterCode = 'local-test-only';
export const localAdminPassword = 'local-admin-test-only';
export const localShareToken = 'local-testing-link-0001';

export async function startDev({ port = Number(process.env.PORT) || 8787, guidePath = process.env.MOZZAI_GUIDE_PATH, modelRun } = {}) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("local database"); } }', compatibilityDate: '2025-09-01', d1Databases: ['DB'], d1Persist: false }));
  const db = await mf.getD1Database('DB');
  const schema = await readFile('schema.sql', 'utf8');
  for (const sql of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(sql).run();
  if (guidePath) {
    const content = await readFile(guidePath, 'utf8');
    await db.prepare('INSERT INTO guides (id,version,content,updated_at) VALUES (?,?,?,?)').bind('mozz', createHash('sha256').update(content).digest('hex').slice(0, 16), content, new Date().toISOString()).run();
  }
  const env = {
    DB: db, SITTER_CODE: process.env.MOZZAI_SITTER_CODE || localSitterCode,
    ADMIN_PASSWORD: process.env.MOZZAI_ADMIN_PASSWORD || localAdminPassword,
    SESSION_SECRET: randomBytes(32).toString('hex'), SHARE_TOKEN: localShareToken,
    ENVIRONMENT: 'development', DAILY_LIMIT: '30',
    AI: { run: modelRun || (async (model, input) => {
      if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) throw new Error('Live AI credentials are not configured.');
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error('Live AI request failed.');
      return data.result;
    }) },
    ASSETS: { async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const allowed = ['/index.html', '/app.js', '/style.css'];
      if (!allowed.includes(pathname)) return new Response('Not found', { status: 404 });
      const content = await readFile(resolve('dist/client', pathname.slice(1)));
      return new Response(content, { headers: { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : pathname.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8' } });
    } }
  };
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const request = new Request(`http://127.0.0.1:${server.address().port}${incoming.url}`, { method: incoming.method, headers: incoming.headers, ...(body.length ? { body, duplex: 'half' } : {}) });
      const response = await handleRequest(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end('Local server error.'); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, env, origin: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await mf.dispose(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.MOZZAI_GUIDE_PATH) throw new Error('Set MOZZAI_GUIDE_PATH to a private Markdown care guide outside Git.');
  const app = await startDev();
  console.log(`Local development is running on port ${app.server.address().port}. Live AI requires Cloudflare credentials. Test link path: /s/${localShareToken}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
