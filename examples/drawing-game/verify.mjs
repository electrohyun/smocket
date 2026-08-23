import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const exampleRoot = dirname(fileURLToPath(import.meta.url));
const labels = ['A', 'B', 'C'];

async function waitForState(page, expected) {
  await page.locator(`main${expected}`).waitFor();
}

async function openPlayer(context, drawer, label) {
  const opened = context.waitForEvent('page');
  await drawer.locator(`.player-card[data-player="${label}"] .open-player`).click();
  const page = await opened;
  await waitForState(page, '[data-connected="true"][data-admitted="true"]');
  return page;
}

async function openRound(context, origin, room) {
  const drawer = await context.newPage();
  await drawer.goto(`${origin}?room=${room}&label=A`);
  await waitForState(drawer, '[data-connected="true"][data-admitted="true"]');
  assert.equal(await drawer.locator('.mascot').getAttribute('src'), '/cat.webp');
  assert.equal(
    await drawer.locator('.mascot').evaluate((image) => image.complete && image.naturalWidth > 0),
    true,
    'the site mascot asset must load',
  );
  assert.equal(
    await drawer.evaluate(
      async () => (await document.fonts.load('12px "JetBrains Mono"')).length > 0,
    ),
    true,
    'the demo mono font must load',
  );
  assert.match(
    await drawer
      .getByLabel('Delivery record')
      .evaluate((element) => getComputedStyle(element).fontFamily),
    /JetBrains Mono/,
  );
  assert.equal(
    await drawer
      .locator('.player-card[data-player="B"] > [data-socket="B"]')
      .evaluate((element) => getComputedStyle(element).opacity),
    '0.42',
    'an unopened player must fade as one complete site character card',
  );
  const guesserB = await openPlayer(context, drawer, 'B');
  const guesserC = await openPlayer(context, drawer, 'C');
  const pages = [drawer, guesserB, guesserC];
  await Promise.all(
    pages.map((page) => waitForState(page, '[data-player-count="3"][data-phase="active"]')),
  );
  return pages;
}

async function verifyHandlerReload(vite, pages) {
  const previousIds = await Promise.all(
    pages.map((page) => page.locator('main').getAttribute('data-socket-id')),
  );
  const version = `verify-${Date.now()}`;
  const reloads = pages.map((page) =>
    page.waitForURL((url) => url.searchParams.get('workerVersion') === version),
  );
  vite.ws.send({
    type: 'custom',
    event: 'drawing-game:handler-changed',
    data: { version },
  });
  await Promise.all(reloads);
  await Promise.all(
    pages.map((page) =>
      waitForState(
        page,
        '[data-connected="true"][data-admitted="true"][data-player-count="3"][data-phase="active"]',
      ),
    ),
  );
  const replacementIds = await Promise.all(
    pages.map((page) => page.locator('main').getAttribute('data-socket-id')),
  );
  assert.equal(new Set(replacementIds).size, 3, 'handler reload must create three current sockets');
  assert.ok(
    replacementIds.every((id, index) => id && id !== previousIds[index]),
    'handler reload must replace the SharedWorker socket identities',
  );
  assert.equal(
    await pages[0].evaluate(() => localStorage.getItem('drawing-game-worker-version')),
    version,
    'handler reload must persist the worker version',
  );
}

async function runRound(pages) {
  const [drawer, guesserB, guesserC] = pages;
  const socketIds = await Promise.all(
    pages.map((page) => page.locator('main').getAttribute('data-socket-id')),
  );
  assert.equal(new Set(socketIds).size, 3, 'each page must have a distinct socket id');
  assert.equal(await drawer.locator('canvas').getAttribute('aria-disabled'), 'false');
  await Promise.all(
    [guesserB, guesserC].map(async (page) =>
      assert.equal(await page.locator('canvas').getAttribute('aria-disabled'), 'true'),
    ),
  );

  const box = await drawer.locator('canvas').boundingBox();
  if (!box) throw new Error('the drawing surface has no browser bounds');
  await drawer.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.35);
  await drawer.mouse.down();
  await drawer.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55, { steps: 5 });
  await drawer.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.3, { steps: 5 });
  await drawer.mouse.up();
  await Promise.all(
    [guesserB, guesserC].map((page) =>
      page.waitForFunction(() => Number(document.querySelector('main')?.dataset.strokeCount) > 0),
    ),
  );
  assert.equal(
    await drawer.locator('main').getAttribute('data-stroke-count'),
    '0',
    'the drawer must not receive its own broadcast',
  );

  await guesserB.getByRole('textbox', { name: 'Guess' }).fill('zebra');
  await guesserB.getByRole('button', { name: 'Send' }).click();
  await waitForState(guesserB, '[data-guess-ack="wrong"]');
  await Promise.all(pages.map((page) => page.locator('[data-event="chat"]').waitFor()));

  await guesserC.getByRole('textbox', { name: 'Guess' }).fill('giraffe');
  await guesserC.getByRole('button', { name: 'Send' }).click();
  await waitForState(guesserC, '[data-guess-ack="correct"]');
  await Promise.all(
    pages.map((page) => waitForState(page, '[data-ended="true"][data-winner="C"]')),
  );
  const fanfareVisibility = await Promise.all(
    pages.map(async (page) => {
      const fanfare = page.locator('.fanfare');
      await fanfare.waitFor({ state: 'visible' });
      return fanfare.isVisible();
    }),
  );
  const resultVisibility = await Promise.all(
    pages.map(async (page) => {
      const result = page.locator('.round-result');
      await result.waitFor({ state: 'visible' });
      return result.isVisible();
    }),
  );

  const strokeCounts = await Promise.all(
    pages.map(async (page) => Number(await page.locator('main').getAttribute('data-stroke-count'))),
  );
  const drawerMain = drawer.locator('main');
  return {
    distinctSocketIds: new Set(socketIds).size === 3,
    playerCount: Number(await drawerMain.getAttribute('data-player-count')),
    phase: await drawerMain.getAttribute('data-phase'),
    strokeRecipients: labels.filter((_, index) => strokeCounts[index] > 0),
    senderExcluded: strokeCounts[0] === 0 ? 'A' : null,
    wrongGuessAcknowledged:
      (await guesserB.locator('main').getAttribute('data-guess-ack')) === 'wrong',
    correctGuessAcknowledged:
      (await guesserC.locator('main').getAttribute('data-guess-ack')) === 'correct',
    fanfarePages: labels.filter((_, index) => fanfareVisibility[index]),
    resultPages: labels.filter((_, index) => resultVisibility[index]),
    winner: await drawerMain.getAttribute('data-winner'),
    word: await drawer.locator('.round-result b').innerText(),
  };
}

async function runTarget(browser, target) {
  const vite = await createServer({
    root: exampleRoot,
    configFile: resolve(exampleRoot, target === 'real' ? 'vite.real.config.ts' : 'vite.config.ts'),
    mode: `verify-${target}`,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
  });
  const context = await browser.newContext();
  try {
    await vite.listen();
    const origin = vite.resolvedUrls?.local[0];
    if (!origin) throw new Error(`Vite did not expose the ${target} example URL`);
    const room = `verify-${target}`;
    const pages = await openRound(context, origin, room);
    if (target === 'smocket') await verifyHandlerReload(vite, pages);
    const observation = await runRound(pages);

    await pages[2].close();
    await Promise.all(
      pages.slice(0, 2).map((page) => waitForState(page, '[data-player-count="2"]')),
    );
    await pages[1].reload();
    await waitForState(
      pages[1],
      '[data-connected="true"][data-admitted="true"][data-player-count="2"]',
    );
    const replacementC = await openPlayer(context, pages[0], 'C');
    await waitForState(replacementC, '[data-player-count="3"][data-ended="true"]');

    await Promise.all([pages[0].close(), pages[1].close(), replacementC.close()]);
    const secondPages = await openRound(context, origin, room);
    const secondIds = await Promise.all(
      secondPages.map((page) => page.locator('main').getAttribute('data-socket-id')),
    );
    assert.equal(new Set(secondIds).size, 3, 'a repeated run must create three current players');
    await Promise.all(secondPages.map((page) => page.close()));
    return observation;
  } finally {
    await Promise.allSettled([context.close(), vite.close()]);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const smocket = await runTarget(browser, 'smocket');
  const real = await runTarget(browser, 'real');
  assert.deepEqual(smocket, real);
  process.stdout.write(
    'Drawing game passed the same three-page workflow with Smocket and Real Socket.IO.\n',
  );
} finally {
  await browser.close();
}
