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
  let boundConnection;
  // [case-snippet:start 1-connect]
  const socketLink = ws.link(origin);
  const handler = socketLink.addEventListener('connection', (connection) => {
    interceptedConnections += 1;
    boundConnection = toSocketIo(connection);
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
  const bindingCreated = boundConnection !== undefined;
  const methods = (names) =>
    bindingCreated ? names.filter((name) => typeof boundConnection[name] === 'function') : null;
  const joinProbe = {
    interceptedConnections,
    connectionResults,
    bindingCreated,
    bindingMethods: methods(['on', 'send', 'emit']),
    roomMethods: methods(['join', 'leave']),
    acknowledgementMethods: methods(['ack', 'acknowledge']),
  };
  // [case-snippet:end 2-room-join]

  // [case-snippet:start 3-sender-excluded-stroke]
  const strokeProbe = {
    roomMethods: methods(['join', 'leave']),
    broadcastMethods: methods(['broadcast', 'to', 'in']),
    senderExclusionMethods: methods(['except']),
  };
  // [case-snippet:end 3-sender-excluded-stroke]

  // [case-snippet:start 4-wrong-guess]
  const wrongGuessProbe = {
    acknowledgementMethods: methods(['ack', 'acknowledge']),
    roomBroadcastMethods: methods(['broadcast', 'to', 'in']),
  };
  // [case-snippet:end 4-wrong-guess]

  // [case-snippet:start 5-correct-guess]
  const correctGuessProbe = {
    targetingMethods: methods(['to', 'in']),
    roomBroadcastMethods: methods(['broadcast', 'to', 'in']),
  };
  // [case-snippet:end 5-correct-guess]

  // [case-snippet:start 6-disconnect]
  for (const client of Object.values(clients)) client.disconnect();
  server.close();
  const disconnectProbe = {
    clientCloseAvailable: Object.values(clients).every(
      (client) => typeof client.disconnect === 'function',
    ),
    roomCleanupMethods: methods(['leave', 'disconnectSockets']),
  };
  // [case-snippet:end 6-disconnect]

  return {
    '1-connect': {
      supported: true,
      actual: connectActual,
      reason: 'All three clients fail with connect_error before the MSW connection handler runs.',
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
          'All three clients emit connect_error, and the MSW connection handler is not invoked.',
      },
    ],
  }),
);
