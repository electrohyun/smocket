import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'tsup';
import { createBrowserErrorMonitor } from './browser-error-monitor.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE = resolve(ROOT, 'browser-tests/shared-worker-lifecycle');
const ROOM = 'lifecycle-room';
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);
const browserErrorProbe = process.argv
  .find((argument) => argument.startsWith('--browser-error-probe='))
  ?.slice('--browser-error-probe='.length);
const ALLOWED_PAGE_ERROR = 'SharedWorker browser error allowlist probe';
const browserErrors = createBrowserErrorMonitor({
  allowed:
    browserErrorProbe === 'allowed-pageerror'
      ? [{ type: 'pageerror', message: ALLOWED_PAGE_ERROR }]
      : [],
});

async function bundleFixture(output) {
  await build({
    entry: {
      page: resolve(FIXTURE, 'page.ts'),
      worker: resolve(FIXTURE, 'worker.ts'),
    },
    outDir: output,
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    bundle: true,
    splitting: false,
    sourcemap: false,
    dts: false,
    clean: true,
  });
}

function startStaticServer(output) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
          '<!doctype html><link rel="icon" href="data:," /><script type="module" src="/page.js"></script>',
        );
        return;
      }
      if (url.pathname === '/neutral') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(
          '<!doctype html><link rel="icon" href="data:," /><title>SharedWorker lifecycle navigation target</title>',
        );
        return;
      }
      const filename = resolve(output, url.pathname.replace(/^\/+/, ''));
      if (filename !== output && !filename.startsWith(`${output}${sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const content = await readFile(filename);
      response.writeHead(200, {
        'Content-Type': CONTENT_TYPES.get(extname(filename)) ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(content);
    } catch (error) {
      response.writeHead(404).end(error instanceof Error ? error.message : String(error));
    }
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('SharedWorker lifecycle server did not receive a TCP address'));
        return;
      }
      resolvePromise({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function closeServer(server) {
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

async function openProbe(context, origin, label, version = 'v1') {
  const page = await context.newPage();
  browserErrors.observe(page, `${label}:${version}`);
  await page.goto(`${origin}/?label=${label}&version=${version}`);
  await page.waitForFunction(() => globalThis.sharedWorkerLifecycleProbe !== undefined);
  await page.evaluate(() => globalThis.sharedWorkerLifecycleProbe.connected);
  return page;
}

async function injectBrowserErrorProbe(page) {
  if (!browserErrorProbe) return;
  if (browserErrorProbe === 'console-error') {
    const message = 'SharedWorker unexpected console error probe';
    const observed = browserErrors.waitFor('console.error', message);
    await page.evaluate((value) => console.error(value), message);
    await observed;
    return;
  }
  if (browserErrorProbe === 'pageerror' || browserErrorProbe === 'allowed-pageerror') {
    const message =
      browserErrorProbe === 'allowed-pageerror'
        ? ALLOWED_PAGE_ERROR
        : 'SharedWorker unexpected page error probe';
    const observed = browserErrors.waitFor('pageerror', message);
    await page.evaluate((value) => {
      queueMicrotask(() => {
        throw new Error(value);
      });
    }, message);
    await observed;
    return;
  }
  throw new Error(`unknown browser error probe: ${browserErrorProbe}`);
}

async function emit(page, event, ...args) {
  await page.evaluate(
    ({ eventName, eventArgs }) =>
      globalThis.sharedWorkerLifecycleProbe.emit(eventName, ...eventArgs),
    { eventName: event, eventArgs: args },
  );
}

async function emitWithAck(page, event, ...args) {
  return page.evaluate(
    ({ eventName, eventArgs }) =>
      globalThis.sharedWorkerLifecycleProbe.emitWithAck(eventName, ...eventArgs),
    { eventName: event, eventArgs: args },
  );
}

async function emitPending(page, event, ...args) {
  await page.evaluate(
    ({ eventName, eventArgs }) =>
      globalThis.sharedWorkerLifecycleProbe.emitPending(eventName, ...eventArgs),
    { eventName: event, eventArgs: args },
  );
}

async function waitForEvent(page, event, expected) {
  return page.evaluate(
    ({ eventName, expectedValue }) =>
      globalThis.sharedWorkerLifecycleProbe.waitFor(eventName, expectedValue),
    { eventName: event, expectedValue: expected },
  );
}

async function observedEvents(page, event) {
  return page.evaluate(
    (eventName) => globalThis.sharedWorkerLifecycleProbe.events(eventName),
    event,
  );
}

async function lifecycleState(page) {
  return page.evaluate(() => globalThis.sharedWorkerLifecycleProbe.state());
}

const output = await mkdtemp(join(tmpdir(), 'smocket-shared-worker-lifecycle-'));
let browser;
let server;

try {
  await bundleFixture(output);
  const started = await startStaticServer(output);
  server = started.server;
  browser = await chromium.launch({
    // Playwright disables BFCache by default, and Chromium's headless delegate rejects it.
    headless: false,
    args: ['--enable-features=BFCacheWithSharedWorker,FreezeSharedWorker'],
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
  });
  const context = await browser.newContext();
  context.setDefaultTimeout(10_000);
  const [pageA, pageB, pageC] = await Promise.all(
    ['A', 'B', 'C'].map((label) => openProbe(context, started.origin, label)),
  );
  await injectBrowserErrorProbe(pageA);

  await Promise.all([
    emitWithAck(pageA, 'join', ROOM),
    emitWithAck(pageB, 'join', ROOM),
    emitWithAck(pageC, 'join', ROOM),
  ]);

  const orderedMarker = waitForEvent(pageB, 'marker', 'after-order');
  await emit(pageA, 'ordered', 1);
  await emit(pageA, 'ordered', 2);
  await emit(pageA, 'marker', 'after-order');
  await orderedMarker;
  assert.deepEqual(await observedEvents(pageB, 'ordered'), [[1], [2]]);

  await emitPending(pageC, 'hold-client-ack', 'unanswered');
  await emit(pageC, 'request-server-ack', 'unanswered');
  await waitForEvent(pageC, 'server-pending', 'unanswered');

  const pageCdp = await context.newCDPSession(pageC);
  await pageCdp.send('Page.enable');
  const backForwardCacheFailures = [];
  pageCdp.on('Page.backForwardCacheNotUsed', (event) => backForwardCacheFailures.push(event));
  const beforeNavigation = await lifecycleState(pageC);
  const left = waitForEvent(pageA, 'player-left', 'C');
  await pageC.goto(`${started.origin}/neutral`);
  await left;
  const closeMarker = waitForEvent(pageB, 'marker', 'after-close');
  await emit(pageA, 'marker', 'after-close');
  await closeMarker;
  assert.deepEqual(await emitWithAck(pageA, 'inspect', ROOM), {
    players: 2,
    roomMembers: 2,
    sockets: 2,
  });

  await pageC.goBack({ waitUntil: 'commit' });
  await pageC.waitForFunction(() => {
    const state = globalThis.sharedWorkerLifecycleProbe?.state();
    return state?.pageshowPersisted.at(-1) === true || state?.navigationType === 'back_forward';
  });
  const restored = await lifecycleState(pageC);
  const notRestoredReasons = [
    ...restored.notRestoredReasons,
    ...backForwardCacheFailures.flatMap(({ notRestoredExplanations }) =>
      notRestoredExplanations.map(({ reason }) => reason),
    ),
  ];
  assert.equal(
    restored.pageshowPersisted.at(-1),
    true,
    `Chromium did not restore the lifecycle page from BFCache: ${notRestoredReasons.join(', ') || 'no reason reported'}`,
  );
  assert.equal(restored.instanceId, beforeNavigation.instanceId);
  assert.deepEqual(restored.pagehidePersisted, [true]);
  assert.deepEqual(restored.pageshowPersisted, [false, true]);
  assert.equal(restored.connected, false);
  assert.equal(restored.socketId, undefined);

  const orderedBeforeReconnect = await observedEvents(pageC, 'ordered');
  const disconnectedMarker = waitForEvent(pageB, 'marker', 'after-bfcache-disconnect');
  await emit(pageA, 'ordered', 3);
  await emit(pageA, 'marker', 'after-bfcache-disconnect');
  await disconnectedMarker;
  assert.deepEqual(await observedEvents(pageC, 'ordered'), orderedBeforeReconnect);

  await pageC.evaluate(() => globalThis.sharedWorkerLifecycleProbe.connect());
  await pageC.waitForFunction(() => globalThis.sharedWorkerLifecycleProbe.state().connected);
  const reconnected = await lifecycleState(pageC);
  assert.notEqual(reconnected.socketId, beforeNavigation.socketId);
  await emitWithAck(pageC, 'join', ROOM);
  assert.deepEqual(await emitWithAck(pageA, 'inspect', ROOM), {
    players: 3,
    roomMembers: 3,
    sockets: 3,
  });
  const reconnectedMarker = waitForEvent(pageC, 'marker', 'after-bfcache-reconnect');
  await emit(pageA, 'ordered', 4);
  await emit(pageA, 'marker', 'after-bfcache-reconnect');
  await reconnectedMarker;
  assert.deepEqual((await observedEvents(pageC, 'ordered')).at(-1), [4]);

  const replacement = await openProbe(context, started.origin, 'C', 'v2');
  await emitWithAck(replacement, 'join', ROOM);
  assert.deepEqual(await emitWithAck(replacement, 'inspect', ROOM), {
    players: 1,
    roomMembers: 1,
    sockets: 1,
  });
  assert.deepEqual(await emitWithAck(pageA, 'inspect', ROOM), {
    players: 3,
    roomMembers: 3,
    sockets: 3,
  });

  browserErrors.assertNoUnexpectedErrors();
  await Promise.all([pageA.close(), pageB.close(), pageC.close(), replacement.close()]);
  await context.close();
  process.stdout.write(
    'Production SharedWorker lifecycle passed in Chromium, including BFCache restoration.\n',
  );
} finally {
  browserErrors.stop();
  await browser?.close();
  if (server) await closeServer(server);
  await rm(output, { recursive: true, force: true });
}
