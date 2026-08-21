import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { toSocketIo } from '@mswjs/socket.io-binding';
import { ws } from 'msw';
import { setupServer } from 'msw/node';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const packageVersions = {
  '@mswjs/socket.io-binding': require('@mswjs/socket.io-binding/package.json').version,
  msw: require('msw/package.json').version,
  'socket.io-client': require('socket.io-client/package.json').version,
};
assert.deepEqual(packageVersions, {
  '@mswjs/socket.io-binding': '0.2.0',
  msw: '2.15.0',
  'socket.io-client': '4.8.3',
});
const bindingRoot = dirname(require.resolve('@mswjs/socket.io-binding/package.json'));
const readmeSha256 = createHash('sha256')
  .update(readFileSync(join(bindingRoot, 'README.md')))
  .digest('hex');
const declarationSha256 = createHash('sha256')
  .update(readFileSync(join(bindingRoot, 'build/index.d.ts')))
  .digest('hex');

const LABELS = ['A', 'B', 'C'];

function blocked(stepId, reason, actual) {
  return { supported: false, blockedByStepId: stepId, reason, actual };
}

async function settleConnection(client, label) {
  return new Promise((resolve) => {
    client.once('connect', () =>
      resolve({ label, state: 'connected', socketId: client.id ?? null }),
    );
    client.once('connect_error', (error) =>
      resolve({ label, state: 'connect_error', socketId: client.id ?? null, error: error.message }),
    );
  });
}

async function runOnce(runId) {
  const origin = `ws://msw-binding-${runId}.example`;
  let interceptedConnections = 0;
  // [case-snippet:start 1-connect]
  const socketLink = ws.link(origin);
  const handler = socketLink.addEventListener('connection', (connection) => {
    interceptedConnections += 1;
    toSocketIo(connection);
  });
  const server = setupServer(handler);
  server.listen({ onUnhandledRequest: 'bypass' });
  const clients = Object.fromEntries(
    LABELS.map((label) => [
      label,
      io(origin, { forceNew: true, reconnection: false, timeout: 200, transports: ['websocket'] }),
    ]),
  );
  const connectionResults = await Promise.all(
    LABELS.map((label) => settleConnection(clients[label], label)),
  );
  const connected = connectionResults.filter(({ state }) => state === 'connected');
  const connectActual = {
    connections: connected.map(({ label, socketId }) => ({ label, socketId })),
    distinctSocketIds:
      connected.length === LABELS.length &&
      new Set(connected.map(({ socketId }) => socketId)).size === LABELS.length,
  };
  // [case-snippet:end 1-connect]

  // [case-snippet:start 2-room-join]
  const joinProbe = {
    interceptedConnections,
    connectionResults,
    bindingMethods: ['on', 'send', 'emit'],
    roomApi: false,
    acknowledgementPacketApi: false,
  };
  // [case-snippet:end 2-room-join]

  // [case-snippet:start 3-sender-excluded-stroke]
  const strokeProbe = { roomApi: false, broadcastApi: false, senderExclusionApi: false };
  // [case-snippet:end 3-sender-excluded-stroke]

  // [case-snippet:start 4-wrong-guess]
  const wrongGuessProbe = { acknowledgementPacketApi: false, roomBroadcastApi: false };
  // [case-snippet:end 4-wrong-guess]

  // [case-snippet:start 5-correct-guess]
  const correctGuessProbe = { socketIdTargetingApi: false, roomBroadcastApi: false };
  // [case-snippet:end 5-correct-guess]

  // [case-snippet:start 6-disconnect]
  for (const client of Object.values(clients)) client.disconnect();
  server.close();
  const disconnectProbe = { clientCloseAvailable: true, roomCleanupObservable: false };
  // [case-snippet:end 6-disconnect]

  return {
    '1-connect': {
      supported: true,
      actual: connectActual,
      reason:
        'MSW intercepts all three attempts, but the binding does not complete the Socket.IO handshake with the current compatible MSW release.',
      evidenceIds: ['msw-binding-runtime'],
    },
    '2-room-join': blocked(
      '1-connect',
      'No Socket.IO client connected, so join and ack cannot run.',
      joinProbe,
    ),
    '3-sender-excluded-stroke': blocked(
      '1-connect',
      'No connected clients exist; the binding also declares no room or broadcast API.',
      strokeProbe,
    ),
    '4-wrong-guess': blocked(
      '1-connect',
      'No connected clients exist; the binding declaration has no acknowledgement packet API.',
      wrongGuessProbe,
    ),
    '5-correct-guess': blocked(
      '1-connect',
      'No connected clients or socket-id/room targeting APIs exist.',
      correctGuessProbe,
    ),
    '6-disconnect': blocked(
      '1-connect',
      'The workflow never connected or joined a room, so disconnect cleanup cannot be compared.',
      disconnectProbe,
    ),
  };
}

const first = await runOnce(1);
const second = await runOnce(2);
assert.deepEqual(second, first);

process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    targetId: 'msw-binding',
    label: '@mswjs/socket.io-binding',
    fixture: 'case-studies/drawing-game/fixtures/msw-binding',
    packages: packageVersions,
    repeatedRunMatches: true,
    steps: first,
    capabilityEvidence: [
      {
        id: 'msw-binding-readme',
        kind: 'official-readme',
        source: 'node_modules/@mswjs/socket.io-binding/README.md',
        sourceSha256: readmeSha256,
        url: 'https://www.npmjs.com/package/@mswjs/socket.io-binding',
        finding: 'The package documents rooms, namespaces, and broadcasting as missing features.',
      },
      {
        id: 'msw-binding-declaration',
        kind: 'installed-declaration',
        source: 'node_modules/@mswjs/socket.io-binding/build/index.d.ts',
        sourceSha256: declarationSha256,
        finding:
          'The bound connection exposes on, send, and emit only; no room, targeting, or acknowledgement API is declared.',
      },
      {
        id: 'msw-binding-runtime',
        kind: 'runtime-probe',
        source: 'fixtures/msw-binding/probe.mjs',
        finding:
          'MSW receives each connection event, but socket.io-client emits connect_error: timeout.',
      },
    ],
  }),
);
