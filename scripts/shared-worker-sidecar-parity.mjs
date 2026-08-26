import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'tsup';
import { createBrowserErrorMonitor } from './browser-error-monitor.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FIXTURE = resolve(ROOT, 'browser-tests/shared-worker-parity');
const ROOM = 'room-1';
const LABELS = ['A', 'B', 'C'];
const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
]);

const EXPECTED = {
  distinctSocketIds: true,
  joins: [
    { accepted: true, room: ROOM, label: 'A', leader: true },
    { accepted: true, room: ROOM, label: 'B', leader: false },
    { accepted: true, room: ROOM, label: 'C', leader: false },
  ],
  canStartBefore: false,
  readyRecipients: [
    { from: 'A', recipients: ['B', 'C'] },
    { from: 'B', recipients: ['A', 'C'] },
    { from: 'C', recipients: ['A', 'B'] },
  ],
  canStartAfter: true,
  startAcknowledgement: { accepted: true },
  startRecipients: ['A', 'B', 'C'],
  ordered: { A: [], B: [[1], [2]], C: [[1], [2]] },
  clientAcknowledgement: { token: 'client-ack', answer: 'first' },
  serverAcknowledgements: [{ token: 'server-ack', answer: 'answer-from-A', calls: 1 }],
  explicitDisconnect: {
    label: 'C',
    connectedAfter: false,
    markerRecipients: ['A', 'B'],
    state: { players: 2, roomMembers: 2, sockets: 2 },
  },
  pageClose: {
    label: 'B',
    markerRecipients: ['A'],
    state: { players: 1, roomMembers: 1, sockets: 1 },
  },
};

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
    noExternal: ['socket.io-client'],
    splitting: false,
    sourcemap: false,
    dts: false,
    clean: true,
  });
  await build({
    entry: { sidecar: resolve(FIXTURE, 'sidecar.ts') },
    outDir: output,
    format: ['esm'],
    platform: 'node',
    target: 'node20',
    bundle: true,
    external: ['socket.io'],
    splitting: false,
    sourcemap: false,
    dts: false,
    clean: false,
  });
}

function startStaticServer(output) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><script type="module" src="/page.js"></script>');
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
        reject(new Error('SharedWorker parity server did not receive a TCP address'));
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

async function openPage(context, origin, target, label, sidecarUrl, browserErrors) {
  const page = await context.newPage();
  browserErrors.observe(page, `${target}:${label}`);
  const url = new URL(origin);
  url.searchParams.set('target', target);
  url.searchParams.set('label', label);
  if (sidecarUrl) url.searchParams.set('sidecar', sidecarUrl);
  await page.goto(url.href);
  await page.waitForFunction(() => globalThis.sharedWorkerParityProbe !== undefined);
  await page.evaluate(() => globalThis.sharedWorkerParityProbe.connected);
  return page;
}

async function emit(page, event, ...args) {
  await page.evaluate(
    ({ eventName, eventArgs }) => globalThis.sharedWorkerParityProbe.emit(eventName, ...eventArgs),
    { eventName: event, eventArgs: args },
  );
}

async function emitWithAck(page, event, ...args) {
  return page.evaluate(
    ({ eventName, eventArgs }) =>
      globalThis.sharedWorkerParityProbe.emitWithAck(eventName, ...eventArgs),
    { eventName: event, eventArgs: args },
  );
}

async function waitForEvent(page, event, expected) {
  return page.evaluate(
    ({ eventName, expectedValue }) =>
      globalThis.sharedWorkerParityProbe.waitFor(eventName, expectedValue),
    { eventName: event, expectedValue: expected },
  );
}

async function events(page, event) {
  return page.evaluate((eventName) => globalThis.sharedWorkerParityProbe.events(eventName), event);
}

async function snapshot(page) {
  return page.evaluate(() => globalThis.sharedWorkerParityProbe.snapshot());
}

async function disconnect(page) {
  await page.evaluate(() => globalThis.sharedWorkerParityProbe.disconnect());
}

async function crossMarker(pages, sender, token) {
  const markers = pages.map((page) => waitForEvent(page, 'marker', token));
  await emit(sender, 'marker', token);
  await Promise.all(markers);
}

async function recipientsFor(pages, event, predicate) {
  const observed = await Promise.all(pages.map((page) => events(page, event)));
  return LABELS.filter((_, index) => observed[index].some(predicate));
}

async function runTarget(browser, origin, target, sidecarUrl) {
  const context = await browser.newContext();
  context.setDefaultTimeout(10_000);
  const pages = [];
  const browserErrors = createBrowserErrorMonitor();

  try {
    for (const label of LABELS) {
      pages.push(await openPage(context, origin, target, label, sidecarUrl, browserErrors));
    }
    const [pageA, pageB, pageC] = pages;
    const ids = await Promise.all(pages.map(async (page) => (await snapshot(page)).id));
    const joins = [];
    for (const page of pages) joins.push(await emitWithAck(page, 'join-lobby', ROOM));

    const canStartBefore = await emitWithAck(pageA, 'get-can-start');
    for (const [index, page] of pages.entries()) {
      await emit(page, 'ready', true);
      await crossMarker(pages, page, `after-ready-${LABELS[index]}`);
    }
    const canStartAfter = (await waitForEvent(pageA, 'can-start', true))[0];

    const readyRecipients = [];
    for (const label of LABELS) {
      readyRecipients.push({
        from: label,
        recipients: await recipientsFor(
          pages,
          'player-ready',
          (args) => args[0]?.label === label && args[0]?.ready === true,
        ),
      });
    }

    const startAcknowledgement = await emitWithAck(pageA, 'start-game');
    await crossMarker(pages, pageA, 'after-start');
    const startRecipients = await recipientsFor(
      pages,
      'start-game',
      (args) => args[0]?.room === ROOM,
    );

    await emit(pageA, 'ordered', 1);
    await emit(pageA, 'ordered', 2);
    await crossMarker(pages, pageA, 'after-order');
    const orderedEntries = await Promise.all(pages.map((page) => events(page, 'ordered')));

    const clientAcknowledgement = await emitWithAck(pageA, 'client-ack-probe', 'client-ack');
    await emit(pageA, 'server-ack-probe', 'server-ack');
    await waitForEvent(pageA, 'server-ack-result', undefined);
    await crossMarker(pages, pageA, 'after-acks');
    const serverAcknowledgements = (await events(pageA, 'server-ack-result')).map(
      (args) => args[0],
    );

    const leftC = waitForEvent(pageA, 'player-left', 'C');
    await disconnect(pageC);
    await leftC;
    await crossMarker([pageA, pageB], pageA, 'after-c-disconnect');
    const explicitMarkerRecipients = await recipientsFor(
      pages,
      'marker',
      (args) => args[0] === 'after-c-disconnect',
    );
    const explicitState = await emitWithAck(pageA, 'inspect', ROOM);
    const connectedAfter = (await snapshot(pageC)).connected;

    const leftB = waitForEvent(pageA, 'player-left', 'B');
    await pageB.close();
    await leftB;
    await crossMarker([pageA], pageA, 'after-b-close');
    const pageCloseMarkerObservations = await Promise.all([
      events(pageA, 'marker'),
      events(pageC, 'marker'),
    ]);
    const pageCloseMarkerRecipients = ['A', 'C'].filter((_, index) =>
      pageCloseMarkerObservations[index].some((args) => args[0] === 'after-b-close'),
    );
    const pageCloseState = await emitWithAck(pageA, 'inspect', ROOM);

    const observation = {
      distinctSocketIds: ids.every(Boolean) && new Set(ids).size === 3,
      joins,
      canStartBefore,
      readyRecipients,
      canStartAfter,
      startAcknowledgement,
      startRecipients,
      ordered: {
        A: orderedEntries[0],
        B: orderedEntries[1],
        C: orderedEntries[2],
      },
      clientAcknowledgement,
      serverAcknowledgements,
      explicitDisconnect: {
        label: 'C',
        connectedAfter,
        markerRecipients: explicitMarkerRecipients,
        state: explicitState,
      },
      pageClose: {
        label: 'B',
        markerRecipients: pageCloseMarkerRecipients,
        state: pageCloseState,
      },
    };

    assert.deepEqual(observation, EXPECTED, `${target} did not match the accepted workflow`);
    browserErrors.assertNoUnexpectedErrors();
    return observation;
  } finally {
    browserErrors.stop();
    await Promise.all(pages.filter((page) => !page.isClosed()).map((page) => page.close()));
    await context.close();
  }
}

const output = await mkdtemp(join(ROOT, '.tmp-shared-worker-parity-'));
let browser;
let staticServer;
let sidecar;

try {
  await bundleFixture(output);
  const started = await startStaticServer(output);
  staticServer = started.server;
  const sidecarModule = await import(pathToFileURL(resolve(output, 'sidecar.js')).href);
  sidecar = await sidecarModule.startRealSidecar();
  browser = await chromium.launch({ headless: true });

  const sharedWorker = await runTarget(browser, started.origin, 'shared-worker');
  const realSocketIo = await runTarget(browser, started.origin, 'real', sidecar.url);
  assert.deepEqual(
    sharedWorker,
    realSocketIo,
    'SharedWorker and real Socket.IO observations differ',
  );
  process.stdout.write('SharedWorker and real Socket.IO matched across three Chromium pages.\n');
} finally {
  await Promise.allSettled([
    browser?.close(),
    sidecar?.close(),
    staticServer ? closeServer(staticServer) : undefined,
  ]);
  await rm(output, { recursive: true, force: true });
}
