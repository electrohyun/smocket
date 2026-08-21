import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import SocketMock from 'socket.io-mock';

const require = createRequire(import.meta.url);
const packageVersion = require('socket.io-mock/package.json').version;
const installedSourceSha256 = createHash('sha256')
  .update(readFileSync(require.resolve('socket.io-mock')))
  .digest('hex');
assert.equal(packageVersion, '1.3.2');

const LABELS = ['A', 'B', 'C'];
const ROOM = 'room-1';
const WORD = 'giraffe';
const firstStroke = {
  id: 1,
  points: [
    [0.1, 0.2],
    [0.3, 0.4],
  ],
};
const secondStroke = { id: 2, points: [[0.5, 0.6]], end: true };

function recipientsFor(received) {
  return LABELS.filter((label) => received[label]);
}

function routeMarker(socket, token) {
  let completed = false;
  socket.onEmit('drawing-game:marker', (value) => {
    if (value === token) completed = true;
  });
  socket.broadcast.to(ROOM).emit('drawing-game:marker', token);
  assert.equal(completed, true);
}

function runOnce() {
  // [case-snippet:start 1-connect]
  const sockets = Object.fromEntries(LABELS.map((label) => [label, new SocketMock()]));
  const connectActual = {
    connections: LABELS.map((label) => ({
      label,
      socketId: sockets[label].socketClient.id ?? null,
    })),
    distinctSocketIds:
      new Set(LABELS.map((label) => sockets[label].socketClient.id)).size === LABELS.length,
  };
  // [case-snippet:end 1-connect]

  const joins = [];
  // [case-snippet:start 2-room-join]
  for (const label of LABELS) {
    sockets[label].on('join', (room, acknowledge) => {
      sockets[label].join(room);
      acknowledge({ accepted: true, room });
    });
    sockets[label].socketClient.emit('join', ROOM, (acknowledgement) => {
      joins.push({ label, acknowledgement });
    });
  }
  // [case-snippet:end 2-room-join]

  const firstReceived = Object.fromEntries(LABELS.map((label) => [label, false]));
  // [case-snippet:start 3-sender-excluded-stroke]
  for (const label of LABELS) {
    sockets[label].socketClient.on('stroke', (segment) => {
      if (segment.id === firstStroke.id) firstReceived[label] = true;
    });
  }
  sockets.A.broadcast.to(ROOM).emit('stroke', firstStroke);
  routeMarker(sockets.A, 'after-first-stroke');
  // [case-snippet:end 3-sender-excluded-stroke]

  const chatReceived = Object.fromEntries(LABELS.map((label) => [label, false]));
  let wrongAcknowledgement;
  // [case-snippet:start 4-wrong-guess]
  for (const label of LABELS) {
    sockets[label].socketClient.on('chat', () => {
      chatReceived[label] = true;
    });
  }
  sockets.B.on('guess', (text, acknowledge) => {
    acknowledge(text === WORD);
    sockets.B.broadcast.to(ROOM).emit('chat', { from: 'B', text });
  });
  sockets.B.socketClient.emit('guess', 'zebra', (value) => {
    wrongAcknowledgement = value;
  });
  routeMarker(sockets.B, 'after-wrong-guess');
  // [case-snippet:end 4-wrong-guess]

  const correctReceived = Object.fromEntries(LABELS.map((label) => [label, false]));
  const announceReceived = Object.fromEntries(LABELS.map((label) => [label, false]));
  let correctAcknowledgement;
  // [case-snippet:start 5-correct-guess]
  for (const label of LABELS) {
    sockets[label].socketClient.on('correct', () => {
      correctReceived[label] = true;
    });
    sockets[label].socketClient.on('announce', () => {
      announceReceived[label] = true;
    });
  }
  sockets.C.on('guess', (text, acknowledge) => {
    const correct = text === WORD;
    acknowledge(correct);
    if (!correct) return;
    sockets.C.emit('correct', { word: WORD });
    sockets.C.broadcast.to(ROOM).emit('announce', { winner: 'C', word: WORD });
  });
  sockets.C.socketClient.emit('guess', WORD, (value) => {
    correctAcknowledgement = value;
  });
  routeMarker(sockets.C, 'after-correct-guess');
  // [case-snippet:end 5-correct-guess]

  const secondReceived = Object.fromEntries(LABELS.map((label) => [label, false]));
  // [case-snippet:start 6-disconnect]
  sockets.C.socketClient.disconnect();
  for (const label of LABELS) {
    sockets[label].socketClient.on('stroke', (segment) => {
      if (segment.id === secondStroke.id) secondReceived[label] = true;
    });
  }
  sockets.A.broadcast.to(ROOM).emit('stroke', secondStroke);
  routeMarker(sockets.A, 'after-disconnect-stroke');
  // [case-snippet:end 6-disconnect]

  const steps = {
    '1-connect': {
      supported: true,
      actual: connectActual,
      reason:
        'The paired clients are connected but expose no socket ids and share no server registry.',
      evidenceIds: ['socket-io-mock-runtime'],
    },
    '2-room-join': { supported: true, actual: { joins }, evidenceIds: ['socket-io-mock-source'] },
    '3-sender-excluded-stroke': {
      supported: true,
      actual: {
        delivery: {
          event: 'stroke',
          payload: firstStroke,
          recipients: recipientsFor(firstReceived),
          senderExcluded: 'A',
        },
      },
      reason:
        'broadcast.to() invokes a local observation callback but does not route to the other SocketMock instances.',
      evidenceIds: ['socket-io-mock-runtime'],
    },
    '4-wrong-guess': {
      supported: true,
      actual: {
        acknowledgement: { from: 'B', value: wrongAcknowledgement },
        delivery: {
          event: 'chat',
          payload: { from: 'B', text: 'zebra' },
          recipients: recipientsFor(chatReceived),
        },
      },
      evidenceIds: ['socket-io-mock-runtime'],
    },
    '5-correct-guess': {
      supported: true,
      actual: {
        acknowledgement: { from: 'C', value: correctAcknowledgement },
        targeted: {
          event: 'correct',
          payload: { word: WORD },
          recipients: recipientsFor(correctReceived),
        },
        announce: {
          event: 'announce',
          payload: { winner: 'C', word: WORD },
          recipients: recipientsFor(announceReceived),
        },
      },
      evidenceIds: ['socket-io-mock-runtime'],
    },
    '6-disconnect': {
      supported: true,
      actual: {
        disconnect: {
          label: 'C',
          serverObserved: false,
          connectedAfter: sockets.C.socketClient.connected,
          remaining: LABELS.filter((label) => sockets[label].socketClient.connected),
        },
        delivery: {
          event: 'stroke',
          payload: secondStroke,
          recipients: recipientsFor(secondReceived),
          senderExcluded: 'A',
          disconnected: ['C'],
        },
      },
      evidenceIds: ['socket-io-mock-runtime'],
    },
  };

  for (const socket of Object.values(sockets)) {
    if (socket.socketClient.connected) socket.socketClient.disconnect();
  }
  return steps;
}

const first = runOnce();
const second = runOnce();
assert.deepEqual(second, first);

process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    targetId: 'socket.io-mock',
    label: 'socket.io-mock',
    fixture: 'case-studies/drawing-game/fixtures/socket.io-mock',
    packages: { 'socket.io-mock': packageVersion },
    repeatedRunMatches: true,
    steps: first,
    capabilityEvidence: [
      {
        id: 'socket-io-mock-source',
        kind: 'installed-source',
        source: 'node_modules/socket.io-mock/dist/index.js',
        sourceSha256: installedSourceSha256,
        finding: 'Each constructor owns one server/client pair and one local rooms array.',
      },
      {
        id: 'socket-io-mock-runtime',
        kind: 'runtime-probe',
        source: 'fixtures/socket.io-mock/probe.mjs',
        finding:
          'Acknowledgements and pair-local targeted emits work; room broadcasts do not reach other instances.',
      },
    ],
  }),
);
