import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const EXPERIMENT_PATH = '/experiments/shared-worker-lobby/index.html';
const ROOM = 'room-1';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
]);

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname = url.pathname === '/' ? EXPERIMENT_PATH : url.pathname;
      const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
      const filename = resolve(ROOT, relative);
      if (filename !== ROOT && !filename.startsWith(`${ROOT}${sep}`)) {
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
        reject(new Error('experiment server did not receive a TCP address'));
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

function waitForEvent(page, event, expected) {
  return page.waitForFunction(
    ({ eventName, expectedValue }) =>
      globalThis.lobby
        ?.snapshot()
        .events.some(
          (entry) =>
            entry.event === eventName &&
            (expectedValue === undefined ||
              entry.args[0] === expectedValue ||
              entry.args[0]?.label === expectedValue),
        ),
    { eventName: event, expectedValue: expected },
  );
}

async function snapshot(page) {
  return page.evaluate(() => globalThis.lobby.snapshot());
}

async function emit(page, event, ...args) {
  await page.evaluate(
    ({ eventName, eventArgs }) => globalThis.lobby.emit(eventName, ...eventArgs),
    { eventName: event, eventArgs: args },
  );
}

async function emitWithAck(page, key, event, ...args) {
  return page.evaluate(
    ({ acknowledgementKey, eventName, eventArgs }) =>
      globalThis.lobby.emitWithAck(acknowledgementKey, eventName, ...eventArgs),
    { acknowledgementKey: key, eventName: event, eventArgs: args },
  );
}

async function crossMarker(pages, sender, token) {
  await emit(sender, 'marker', token);
  await Promise.all(pages.map((page) => waitForEvent(page, 'marker', token)));
}

function eventArgs(observation, event) {
  return observation.events.filter((entry) => entry.event === event).map((entry) => entry.args);
}

async function openLobbyPage(context, origin, label, round) {
  const page = await context.newPage();
  page.on('pageerror', (error) => process.stderr.write(`[${label}${round}] ${error.stack}\n`));
  await page.goto(`${origin}${EXPERIMENT_PATH}?label=${label}&round=${round}`);
  await page.waitForFunction(() => globalThis.lobby?.snapshot().connected === true);
  return page;
}

async function runReplacementProbe(context, origin) {
  const page = await context.newPage();
  await page.goto(`${origin}${EXPERIMENT_PATH}?anchor=1`);

  try {
    return await page.evaluate(
      async ({ room, workerName, serverOrigin }) => {
        const { MESSAGE_TYPES, bridgeMessage, readProtocolMessage } =
          await import('./protocol.mjs');
        const worker = new SharedWorker(new URL('./shared-worker.mjs', location.href), {
          name: workerName,
          type: 'module',
        });
        const port = worker.port;
        const messages = [];
        const waiters = [];

        const receive = (predicate) => {
          const existing = messages.find(predicate);
          if (existing) return Promise.resolve(existing);
          return new Promise((resolvePromise) => waiters.push({ predicate, resolvePromise }));
        };

        port.addEventListener('message', (event) => {
          const message = readProtocolMessage(event.data);
          messages.push(message);
          for (let index = waiters.length - 1; index >= 0; index -= 1) {
            const waiter = waiters[index];
            if (!waiter.predicate(message)) continue;
            waiters.splice(index, 1);
            waiter.resolvePromise(message);
          }
        });
        port.start();

        port.postMessage(
          bridgeMessage(MESSAGE_TYPES.CONNECT, {
            requestId: 'replacement-first',
            url: serverOrigin,
            auth: { label: 'A', holdConnection: true },
          }),
        );
        port.postMessage(
          bridgeMessage(MESSAGE_TYPES.CONNECT, {
            requestId: 'replacement-second',
            url: serverOrigin,
            auth: { label: 'A' },
          }),
        );

        const connected = await receive(
          (message) =>
            message.type === MESSAGE_TYPES.CONNECTED && message.requestId === 'replacement-second',
        );
        port.postMessage(
          bridgeMessage(MESSAGE_TYPES.CLIENT_EMIT, {
            generation: connected.generation,
            event: 'experiment:inspect',
            args: [room],
            ackId: 'replacement-inspect',
          }),
        );
        const inspection = await receive(
          (message) =>
            message.type === MESSAGE_TYPES.ACK && message.ackId === 'replacement-inspect',
        );
        port.postMessage(
          bridgeMessage(MESSAGE_TYPES.DISCONNECT, {
            generation: connected.generation,
            reason: 'replacement probe complete',
          }),
        );
        const disconnected = await receive(
          (message) => message.type === MESSAGE_TYPES.DISCONNECTED,
        );
        port.close();

        return {
          connectedRequestIds: messages
            .filter((message) => message.type === MESSAGE_TYPES.CONNECTED)
            .map((message) => message.requestId),
          inspection: inspection.args[0],
          disconnectReason: disconnected.reason,
          workerId: connected.workerId,
        };
      },
      {
        room: ROOM,
        workerName: 'smocket-shared-worker-lobby-experiment',
        serverOrigin: origin,
      },
    );
  } finally {
    await page.close();
  }
}

async function runRound(context, origin, round, expectedWorkerId) {
  const [pageA, pageB, pageC] = await Promise.all(
    ['A', 'B', 'C'].map((label) => openLobbyPage(context, origin, label, round)),
  );
  const pages = [pageA, pageB, pageC];

  try {
    const connected = await Promise.all(pages.map(snapshot));
    assert.equal(new Set(connected.map((entry) => entry.id)).size, 3, 'socket ids are distinct');
    assert.equal(new Set(connected.map((entry) => entry.workerId)).size, 1, 'worker id is shared');
    const workerId = connected[0].workerId;
    if (expectedWorkerId) assert.equal(workerId, expectedWorkerId, 'repeat uses the same worker');

    const cleanStart = await emitWithAck(
      pageA,
      `inspect-start-${round}`,
      'experiment:inspect',
      ROOM,
    );
    assert.deepEqual(
      {
        activeConnections: cleanStart.activeConnections,
        pendingServerAcks: cleanStart.pendingServerAcks,
        lobbyPlayers: cleanStart.lobbyPlayers,
        lobbyRooms: cleanStart.lobbyRooms,
        roomMembers: cleanStart.roomMembers,
        serverSockets: cleanStart.serverSockets,
      },
      {
        activeConnections: 3,
        pendingServerAcks: 0,
        lobbyPlayers: 0,
        lobbyRooms: 0,
        roomMembers: 0,
        serverSockets: 3,
      },
      'repeat starts without prior socket, room, or acknowledgement state',
    );

    const joins = [];
    for (const [index, page] of pages.entries()) {
      joins.push(await emitWithAck(page, `join-${round}-${index}`, 'join-lobby', ROOM));
    }
    assert.deepEqual(joins, [
      { accepted: true, room: ROOM, leader: true },
      { accepted: true, room: ROOM, leader: false },
      { accepted: true, room: ROOM, leader: false },
    ]);

    assert.equal(
      await emitWithAck(pageA, `can-start-before-${round}`, 'get-can-start'),
      false,
      'leader cannot start before all players are ready',
    );

    await emit(pageA, 'ready', true);
    await crossMarker(pages, pageA, `after-a-ready-${round}`);
    const afterAReady = await Promise.all(pages.map(snapshot));
    assert.equal(
      eventArgs(afterAReady[0], 'player-ready').length,
      0,
      'sender exclusion uses marker proof',
    );
    for (const observation of afterAReady.slice(1)) {
      assert.deepEqual(eventArgs(observation, 'player-ready').at(-1), [
        { label: 'A', ready: true },
      ]);
    }

    await emit(pageB, 'ready', true);
    await crossMarker(pages, pageB, `after-b-ready-${round}`);
    await emit(pageC, 'ready', true);
    await crossMarker(pages, pageC, `after-c-ready-${round}`);
    await pageA.waitForFunction(() =>
      globalThis.lobby
        .snapshot()
        .events.some((entry) => entry.event === 'can-start' && entry.args[0] === true),
    );

    assert.deepEqual(await emitWithAck(pageA, `start-${round}`, 'start-game'), { accepted: true });
    await crossMarker(pages, pageA, `after-start-${round}`);
    for (const observation of await Promise.all(pages.map(snapshot))) {
      assert.deepEqual(eventArgs(observation, 'start-game').at(-1), [{ room: ROOM }]);
    }

    await emit(pageA, 'ordered', 1);
    await emit(pageA, 'ordered', 2);
    await crossMarker(pages, pageA, `after-order-${round}`);
    const ordered = await Promise.all(pages.map(snapshot));
    assert.deepEqual(
      eventArgs(ordered[0], 'ordered'),
      [],
      'sender receives the later marker but no broadcast',
    );
    assert.deepEqual(eventArgs(ordered[1], 'ordered'), [[1], [2]], 'B preserves FIFO');
    assert.deepEqual(eventArgs(ordered[2], 'ordered'), [[1], [2]], 'C preserves FIFO');

    const clientAckKey = `client-ack-${round}`;
    assert.deepEqual(await emitWithAck(pageA, clientAckKey, 'client-ack-probe', clientAckKey), {
      token: clientAckKey,
      answer: 'first',
    });
    await crossMarker(pages, pageA, `after-client-ack-${round}`);
    assert.equal((await snapshot(pageA)).acknowledgementCalls[clientAckKey], 1);

    const serverAckToken = `server-ack-${round}`;
    await emit(pageA, 'server-ack-probe', serverAckToken);
    await waitForEvent(pageA, 'server-ack-result');
    await crossMarker(pages, pageA, `after-server-ack-${round}`);
    const serverAckResult = eventArgs(await snapshot(pageA), 'server-ack-result').find(
      ([result]) => result.token === serverAckToken,
    );
    assert.deepEqual(serverAckResult, [
      { token: serverAckToken, answer: 'answer-from-A', calls: 1 },
    ]);

    await pageB.evaluate(({ key }) => globalThis.lobby.emitPending(key, 'never-ack', key), {
      key: `pending-client-${round}`,
    });
    assert.equal((await snapshot(pageB)).pendingClientAcks, 1);

    const pendingServerToken = `pending-server-${round}`;
    await emit(pageC, 'request-pending-server-ack', pendingServerToken);
    await waitForEvent(pageC, 'pending-server-ack', pendingServerToken);
    const withPending = await emitWithAck(
      pageA,
      `inspect-pending-${round}`,
      'experiment:inspect',
      ROOM,
    );
    assert.equal(withPending.pendingServerAcks, 1);

    const waitForBLeft = waitForEvent(pageA, 'player-left', 'B');
    await pageB.evaluate(() => globalThis.lobby.disconnect());
    await waitForBLeft;
    const disconnectedB = await snapshot(pageB);
    assert.equal(disconnectedB.connected, false);
    assert.equal(disconnectedB.pendingClientAcks, 0);

    const waitForCLeft = waitForEvent(pageA, 'player-left', 'C');
    await pageC.close();
    await waitForCLeft;
    const afterClose = await emitWithAck(
      pageA,
      `inspect-close-${round}`,
      'experiment:inspect',
      ROOM,
    );
    assert.deepEqual(
      {
        activeConnections: afterClose.activeConnections,
        pendingServerAcks: afterClose.pendingServerAcks,
        lobbyPlayers: afterClose.lobbyPlayers,
        lobbyRooms: afterClose.lobbyRooms,
        roomMembers: afterClose.roomMembers,
        serverSockets: afterClose.serverSockets,
      },
      {
        activeConnections: 1,
        pendingServerAcks: 0,
        lobbyPlayers: 1,
        lobbyRooms: 1,
        roomMembers: 1,
        serverSockets: 1,
      },
      'page close removes the socket, room membership, participant, and pending server ack',
    );

    await pageA.evaluate(() => globalThis.lobby.disconnect());
    await pageA.close();
    await pageB.close();
    return workerId;
  } finally {
    await Promise.all(pages.filter((page) => !page.isClosed()).map((page) => page.close()));
  }
}

const { server, origin } = await startStaticServer();

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  context.setDefaultTimeout(10_000);
  const anchor = await context.newPage();
  anchor.on('console', (message) => process.stderr.write(`[anchor console] ${message.text()}\n`));
  anchor.on('pageerror', (error) => process.stderr.write(`[anchor error] ${error.stack}\n`));
  anchor.on('requestfailed', (request) =>
    process.stderr.write(`[anchor request] ${request.url()} ${request.failure()?.errorText}\n`),
  );
  await anchor.goto(`${origin}${EXPERIMENT_PATH}?anchor=1`);
  await anchor.waitForFunction(() => globalThis.lobbyAnchor === true);

  const replacement = await runReplacementProbe(context, origin);
  assert.deepEqual(replacement.connectedRequestIds, ['replacement-second']);
  assert.equal(replacement.inspection.activeConnections, 1);
  assert.equal(replacement.inspection.serverSockets, 1);
  assert.equal(replacement.disconnectReason, 'replacement probe complete');

  const workerId = await runRound(context, origin, 1, replacement.workerId);
  await runRound(context, origin, 2, workerId);

  await anchor.close();
  await context.close();
  process.stdout.write('SharedWorker lobby experiment passed twice in one Chromium worker.\n');
} finally {
  await browser?.close();
  await closeServer(server);
}
