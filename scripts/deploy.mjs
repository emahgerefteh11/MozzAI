import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const sitter = process.env.MOZZAI_SITTER_CODE;
const admin = process.env.MOZZAI_ADMIN_PASSWORD;
const guidePath = process.env.MOZZAI_GUIDE_PATH;
if (!account || !token || !guidePath) throw new Error('Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and MOZZAI_GUIDE_PATH securely before deployment.');
if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error('CLOUDFLARE_ACCOUNT_ID must be the account ID, not an email or API key.');
if (!sitter || sitter.length < 6 || !admin || admin.length < 16 || sitter === admin) throw new Error('Set a sitter code of at least 6 characters and a different admin password of at least 16 characters through secure environment settings.');
const name = process.env.MOZZAI_WORKER_NAME || 'mozzai-family-pilot';
if (!/^[a-z0-9-]{3,50}$/.test(name)) throw new Error('Invalid Worker name.');

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare operation failed (${response.status}, codes ${(data.errors || []).map(e => e.code).join(',')}). Check account-scoped permissions and network access.`);
  return data.result;
}
function run(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { env: { ...process.env, NODE_USE_ENV_PROXY: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['pipe', 'pipe', 'pipe'] });
    // Wrangler output may contain account metadata; never print deployment secrets.
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`Wrangler failed with exit status ${code}. No secret values were printed. Inspect account permissions, network access, or run Wrangler directly without exposing credentials.`)));
    child.stdin.end(input || '');
  });
}

const content = await readFile(guidePath, 'utf8');
if (!/## Confirmed care instructions/i.test(content)) throw new Error('Supply the expected care-guide export; no deployment was attempted.');
const databases = await api('/d1/database');
let database = databases.find(item => item.name === `${name}-feedback`);
if (!database) database = await api('/d1/database', { method: 'POST', body: { name: `${name}-feedback` } });
const databaseId = database.uuid;
const schema = await readFile('schema.sql', 'utf8');
for (const sql of schema.split(';').map(s => s.trim()).filter(Boolean)) await api(`/d1/database/${databaseId}/query`, { method: 'POST', body: { sql } });
const version = createHash('sha256').update(content).digest('hex').slice(0, 16);
await api(`/d1/database/${databaseId}/query`, { method: 'POST', body: { sql: 'INSERT INTO guides (id,version,content,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,content=excluded.content,updated_at=excluded.updated_at', params: ['mozz', version, content, new Date().toISOString()] } });

// Read existing secrets by name only. Preserve link and session secrets across ordinary redeploys.
let existing = [];
try { existing = await api(`/workers/scripts/${name}/secrets`); } catch { /* A first deployment has no script. Secret creation below must succeed before the link is reported. */ }
const secretNames = new Set(existing.map(item => item.name));
const newShareToken = secretNames.has('SHARE_TOKEN') ? null : randomBytes(24).toString('base64url');
const config = {
  name, account_id: account, main: resolve('dist/worker.mjs'), compatibility_date: '2025-09-01', workers_dev: true,
  assets: { directory: resolve('dist/client'), binding: 'ASSETS', run_worker_first: true },
  d1_databases: [{ binding: 'DB', database_name: `${name}-feedback`, database_id: databaseId }],
  ai: { binding: 'AI' }, vars: { AI_MODEL: '@cf/openai/gpt-oss-120b', DAILY_LIMIT: '30' }
};
await mkdir('.deploy', { recursive: true });
await writeFile('.deploy/wrangler.json', JSON.stringify(config, null, 2), { mode: 0o600 });
await run(['deploy', '--config', '.deploy/wrangler.json', '--keep-vars']);
const secrets = { SITTER_CODE: sitter, ADMIN_PASSWORD: admin };
if (!secretNames.has('SESSION_SECRET')) secrets.SESSION_SECRET = randomBytes(48).toString('hex');
if (newShareToken) secrets.SHARE_TOKEN = newShareToken;
await run(['secret', 'bulk', '--config', '.deploy/wrangler.json'], JSON.stringify(secrets));
const subdomain = await api('/workers/subdomain');
if (!subdomain.subdomain) throw new Error('Enable the account’s workers.dev subdomain in the Cloudflare dashboard. The app has not been verified publicly.');
const origin = `https://${name}.${subdomain.subdomain}.workers.dev`;
const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ role: 'admin', password: admin }) });
if (!login.ok) throw new Error('Deployment completed but owner sign-in verification failed. No hosted-link readiness claim is made.');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
const shareResponse = await fetch(origin + '/api/admin/share', { headers: { Cookie: cookie } });
if (!shareResponse.ok) throw new Error('Unable to verify the deployed share link.');
const { url } = await shareResponse.json();
await writeFile('.deploy/links.json', JSON.stringify({ tester: url, owner: origin + '/admin', guideVersion: version }, null, 2), { mode: 0o600 });
console.log(`Deployed and verified owner sign-in. Tester link: ${url}\nOwner dashboard: ${origin}/admin\nThe sitter code and owner password remain the values set in secure environment settings. Live AI evaluation must still be run.`);
