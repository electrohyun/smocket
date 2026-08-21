import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Server, SocketIO } from 'mock-socket';

const require = createRequire(import.meta.url);
const packageVersion = require('mock-socket/package.json').version;
const declarationSha256 = createHash('sha256')
  .update(readFileSync(require.resolve('mock-socket/index.d.ts')))
  .digest('hex');
assert.equal(packageVersion, '9.3.1');

const LABELS = ['A', 'B', 'C'];
const ROOM = 'room-1';
const firstStroke = {
  id: 1,
  points: [
    [0.1, 0.2],
    [0.3, 0.4],
  ],
};

function waitForConnections(clients) {
  return Promise.all(
    clients.map(
      (client) =>
        new Promise((resolve) => {
          if (client.readyState === SocketIO.OPEN) resolve();
          else client.on('connect', resolve);
        }),
    ),
  );
}

function blocked(blockedByStepId, reason, actual) {
  return { supported: false, blockedByStepId, reason, actual };
}

async function runOnce(runId) {
  const url = `ws://mock-socket-${runId}.example`;
  const server = new Server(url, { mock: false });
  const connectionArguments = [];
  server.on('connection', (...args) => connectionArguments.push(args));

  // [case-snippet:start 1-connect]
  const clients = Object.fromEntries(LABELS.map((label) => [label, SocketIO(url)]));
  await waitForConnections(Object.values(clients));
  const connectActual = {
    connections: LABELS.map((label) => ({ label, socketId: clients[label].id ?? null })),
    distinctSocketIds: new Set(LABELS.map((label) => clients[label].id)).size === LABELS.length,
  };
  // [case-snippet:end 1-connect]

  let joinAcknowledgement;
  let joinListenerThis;
  let joinArguments;
  // [case-snippet:start 2-room-join]
  server.on('join', function (...args) {
    joinListenerThis = this;
    joinArguments = args;
    const [room, acknowledge] = args;
    acknowledge({ accepted: true, room });
  });
  clients.A.emit('join', ROOM, (value) => {
    joinAcknowledgement = value;
  });
  const joinProbe = {
    acknowledgement: joinAcknowledgement,
    listenerRunsOnSharedServer: joinListenerThis === server,
    listenerArgumentTypes: joinArguments.map((value) => typeof value),
    originatingSocketArgument: joinArguments.some((value) =>
      LABELS.some((label) => value === clients[label]),
    ),
  };
  // [case-snippet:end 2-room-join]

  const directRecipients = [];
  const markerRecipients = [];
  // [case-snippet:start 3-sender-excluded-stroke]
  for (const label of LABELS) {
    clients[label].join(ROOM);
    clients[label].on('stroke', () => directRecipients.push(label));
    clients[label].on('drawing-game:marker', () => markerRecipients.push(label));
  }
  clients.A.to(ROOM).emit('stroke', firstStroke);
  clients.A.to(ROOM).emit('drawing-game:marker', 'after-direct-stroke');
  const directRoutingProbe = {
    initiator: 'client',
    recipients: directRecipients,
    markerRecipients,
  };
  // [case-snippet:end 3-sender-excluded-stroke]

  let guessAcknowledgement;
  // [case-snippet:start 4-wrong-guess]
  server.on('guess', (text, acknowledge) => acknowledge(text === 'giraffe'));
  clients.B.emit('guess', 'zebra', (value) => {
    guessAcknowledgement = value;
  });
  const wrongGuessProbe = {
    acknowledgement: guessAcknowledgement,
    originatingSocketAvailableToHandler: false,
  };
  // [case-snippet:end 4-wrong-guess]

  // [case-snippet:start 5-correct-guess]
  const targetedProbe = {
    serverHasSocketIdTargeting: typeof server.to === 'function' && clients.C.id !== undefined,
    clientId: clients.C.id ?? null,
  };
  // [case-snippet:end 5-correct-guess]

  // [case-snippet:start 6-disconnect]
  clients.C.disconnect();
  const disconnectProbe = {
    connectedClientsAfterCDisconnect: server.clients().length,
    cReadyState: clients.C.readyState,
  };
  // [case-snippet:end 6-disconnect]

  for (const client of Object.values(clients)) client.disconnect();
  server.stop();

  return {
    '1-connect': {
      supported: true,
      actual: connectActual,
      reason: 'Three clients connect, but the public SocketIO facade supplies no socket ids.',
      evidenceIds: ['mock-socket-declaration'],
    },
    '2-room-join': {
      supported: false,
      actual: joinProbe,
      reason:
        'The server event listener receives room and ack but no originating per-connection socket to join.',
      evidenceIds: ['mock-socket-runtime-origin', 'mock-socket-declaration'],
    },
    '3-sender-excluded-stroke': blocked(
      '2-room-join',
      'The workflow cannot establish server-owned room membership for the originating socket.',
      directRoutingProbe,
    ),
    '4-wrong-guess': blocked(
      '2-room-join',
      'The ack crosses, but the handler cannot identify B to create the room chat payload and route it.',
      wrongGuessProbe,
    ),
    '5-correct-guess': blocked(
      '2-room-join',
      'The handler has neither an originating socket id nor server-side socket targeting for C.',
      targetedProbe,
    ),
    '6-disconnect': blocked(
      '2-room-join',
      'Disconnect cleanup exists, but the required server-owned room workflow was never established.',
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
    targetId: 'mock-socket',
    label: 'mock-socket',
    fixture: 'case-studies/drawing-game/fixtures/mock-socket',
    packages: { 'mock-socket': packageVersion },
    repeatedRunMatches: true,
    steps: first,
    capabilityEvidence: [
      {
        id: 'mock-socket-declaration',
        kind: 'installed-declaration',
        source: 'node_modules/mock-socket/index.d.ts',
        sourceSha256: declarationSha256,
        finding:
          'SocketIOClient exposes join/to/broadcast but no id; Server connection types do not model a Socket.IO server socket.',
      },
      {
        id: 'mock-socket-runtime-origin',
        kind: 'runtime-probe',
        source: 'fixtures/mock-socket/probe.mjs',
        finding:
          'A join listener receives only the room and acknowledgement and runs on the shared Server object.',
      },
    ],
  }),
);
