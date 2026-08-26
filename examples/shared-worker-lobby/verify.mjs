import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createBrowserErrorMonitor } from '../../scripts/browser-error-monitor.mjs';

const exampleRoot = dirname(fileURLToPath(import.meta.url));
const vite = await createServer({
  root: exampleRoot,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
const browserErrors = createBrowserErrorMonitor();

try {
  await vite.listen();
  const origin = vite.resolvedUrls?.local[0];
  if (!origin) throw new Error('Vite did not expose the SharedWorker example URL');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const pages = [];
  for (const label of ['A', 'B', 'C']) {
    const page = await context.newPage();
    browserErrors.observe(page, `lobby:${label}`);
    await page.goto(`${origin}?label=${label}`);
    await page.locator('body[data-connected="true"]').waitFor();
    pages.push(page);
  }

  await Promise.all(
    pages.map((page) => page.waitForFunction(() => document.body.dataset.playerCount === '3')),
  );
  const socketIds = await Promise.all(
    pages.map((page) => page.locator('#socket-id').textContent()),
  );
  assert.equal(new Set(socketIds).size, 3, 'each page must receive a distinct socket id');

  await Promise.all(pages.map((page) => page.locator('#ready').click()));
  await pages[0].waitForFunction(() => document.body.dataset.canStart === 'true');
  await pages[0].locator('#start').click();
  await Promise.all(
    pages.map((page) => page.waitForFunction(() => document.body.dataset.startedBy === 'A')),
  );

  await pages[2].close();
  await Promise.all(
    pages
      .slice(0, 2)
      .map((page) => page.waitForFunction(() => document.body.dataset.playerCount === '2')),
  );
  browserErrors.assertNoUnexpectedErrors();
  await context.close();
  process.stdout.write('SharedWorker lobby example passed across pages A, B, and C.\n');
} finally {
  browserErrors.stop();
  await Promise.allSettled([browser?.close(), vite.close()]);
}
