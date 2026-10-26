import { chromium } from 'playwright';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { startDev, localSitterCode, localAdminPassword, localShareToken } from './dev.mjs';

// Browser plumbing only: fictional guide and an explicit model stub. This does not evaluate a live LLM.
const fixture = '# Example sitter care guide\n## Confirmed care instructions\n### Feeding\n- Fictional instructions for browser testing.\n## Unanswered questions\n- Medication instructions are unknown.\n';
const fixturePath = join(tmpdir(), `mozzai-browser-fixture-${process.pid}.md`);
await writeFile(fixturePath, fixture, { mode: 0o600 });
const app = await startDev({ port: 0, guidePath: fixturePath, modelRun: async () => ({ response: JSON.stringify({ type: 'answer', answer: 'Fictional instructions for browser testing.', sources: ['feeding'] }) }) });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(app.origin + '/s/' + localShareToken);
  await page.getByLabel('Access code').fill(localSitterCode);
  await page.getByRole('button', { name: 'Open Mozz’s care space' }).click();
  await page.getByRole('heading', { name: 'A question? Start here.' }).waitFor();
  assert.ok(await page.getByText('Draft · Testing only').isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByLabel('Your question about Mozz').fill('What is the fictional meal?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await page.getByText('Fictional instructions for browser testing.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Not quite' }).click();
  await page.getByLabel('What would you like us to know?').fill('Browser test: useful feedback');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByText('Thank you—your feedback has been saved.').waitFor();
  await mkdir('.artifacts', { recursive: true });
  await page.screenshot({ path: '.artifacts/mobile-chat.png', fullPage: true });
  await page.getByRole('button', { name: 'Care guide', exact: true }).click();
  await page.getByRole('heading', { name: 'Feeding' }).waitFor();
  await page.goto(app.origin + '/admin');
  await page.getByLabel('Owner password').fill(localAdminPassword);
  await page.getByRole('button', { name: 'Open feedback hub' }).click();
  await page.getByText('Browser test: useful feedback', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: '.artifacts/owner-dashboard.png', fullPage: true });
  assert.equal((await page.locator('#qr-code').evaluate(canvas => canvas.width)) > 0, true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByText('A little quiet here. Feedback will appear after a tester submits it.').waitFor();
  assert.deepEqual(errors, []);
  console.log('Browser flow passed: mobile sign-in, draft guide, chat rendering, answer feedback, owner review, QR rendering, and deletion. The model was explicitly stubbed; live AI quality remains untested.');
} finally { await browser.close(); await app.close(); await unlink(fixturePath); }
