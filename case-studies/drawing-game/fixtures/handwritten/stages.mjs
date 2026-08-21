import assert from 'node:assert/strict';
import { createBaseFake } from './stage-sources/01-base-single-client.mjs';
import { createMultipleClientFake } from './stage-sources/02-multiple-clients.mjs';
import { createRoomFake } from './stage-sources/03-room-broadcast.mjs';
import { createSenderExclusionFake } from './stage-sources/04-sender-exclusion.mjs';
import { createAcknowledgementFake } from './stage-sources/05-acknowledgement.mjs';
import { createTargetedDeliveryFake } from './stage-sources/06-targeted-delivery.mjs';
import { createDisconnectFake } from './stage-sources/07-disconnect-cleanup.mjs';

const BARRIER_EVENT = 'handwritten-stage:barrier';
const MARKER_EVENT = 'handwritten-stage:marker';

function observe(client, event) {
  const values = [];
  client.on(event, (value) => values.push(value));
  return values;
}

function waitForMarker(client, token) {
  return new Promise((resolve) => {
    client.on(MARKER_EVENT, (value) => {
      if (value === token) resolve();
    });
  });
}

async function crossBarrier(sender, recipients, token) {
  const markers = recipients.map((client) => waitForMarker(client, token));
  sender.emit(BARRIER_EVENT, token);
  await Promise.all(markers);
}

function trackConnections(server, configure) {
  const sockets = [];
  server.on('connection', (socket) => {
    sockets.push(socket);
    socket.on(BARRIER_EVENT, (token) => {
      for (const peer of sockets) {
        if (peer.connected !== false) peer.emit(MARKER_EVENT, token);
      }
    });
    configure?.(socket);
  });
  return sockets;
}

async function runBaseStage() {
  const { clientSocket, serverSocket } = createBaseFake({ status: 'ready' });
  const responses = observe(clientSocket, 'response');
  serverSocket.on(BARRIER_EVENT, (token) => serverSocket.emit(MARKER_EVENT, token));
  clientSocket.emit('request');
  await crossBarrier(clientSocket, [clientSocket], 'after-base-response');
  assert.deepEqual(responses, [{ status: 'ready' }]);
  return {
    id: 'base-single-client',
    passed: true,
    assertions: ['one client/server pair returned one configured response'],
  };
}

async function runMultipleClientsStage() {
  const { server, connect } = createMultipleClientFake();
  const serverSockets = trackConnections(server);
  const clients = [connect(), connect(), connect()];
  const deliveries = clients.map((client) => observe(client, 'direct'));
  serverSockets[1].emit('direct', 'second only');
  await crossBarrier(clients[1], clients, 'after-direct-delivery');
  assert.equal(new Set(clients.map(({ id }) => id)).size, clients.length);
  assert.deepEqual(deliveries, [[], ['second only'], []]);
  return {
    id: 'multiple-clients',
    passed: true,
    assertions: ['three clients had distinct ids', 'direct delivery kept listeners independent'],
  };
}

async function runRoomBroadcastStage() {
  const { server, connect } = createRoomFake();
  const room = 'stage-room-broadcast';
  trackConnections(server, (socket) => {
    socket.on('join-stage', (targetRoom) => socket.join(targetRoom));
    socket.on('publish', (value) => server.to(room).emit('room-message', value));
  });
  const clients = [connect(), connect(), connect()];
  const deliveries = clients.map((client) => observe(client, 'room-message'));
  for (const client of clients) client.emit('join-stage', room);
  clients[0].emit('publish', 'room payload');
  await crossBarrier(clients[0], clients, 'after-room-payload');
  assert.deepEqual(deliveries, [['room payload'], ['room payload'], ['room payload']]);
  return {
    id: 'room-broadcast',
    passed: true,
    assertions: ['room membership routed one payload to all three members'],
  };
}

async function runSenderExclusionStage() {
  const { server, connect } = createSenderExclusionFake();
  const room = 'stage-sender-exclusion';
  trackConnections(server, (socket) => {
    socket.on('join-stage', (targetRoom) => socket.join(targetRoom));
    socket.on('publish', (value) => socket.to(room).emit('peer-message', value));
  });
  const clients = [connect(), connect(), connect()];
  const deliveries = clients.map((client) => observe(client, 'peer-message'));
  for (const client of clients) client.emit('join-stage', room);
  clients[0].emit('publish', 'peer payload');
  await crossBarrier(clients[0], clients, 'after-peer-payload');
  assert.deepEqual(deliveries, [[], ['peer payload'], ['peer payload']]);
  return {
    id: 'sender-exclusion',
    passed: true,
    assertions: ['the sender was absent after a causally later marker'],
  };
}

async function runAcknowledgementStage() {
  const { server, connect } = createAcknowledgementFake();
  trackConnections(server, (socket) => {
    socket.on('request', (value, acknowledge) => acknowledge({ accepted: value === 'known' }));
  });
  const client = connect();
  const acknowledgement = await new Promise((resolve) => client.emit('request', 'known', resolve));
  await crossBarrier(client, [client], 'after-acknowledgement');
  assert.deepEqual(acknowledgement, { accepted: true });
  return {
    id: 'acknowledgement',
    passed: true,
    assertions: ['the server returned one value through the client callback'],
  };
}

async function runTargetedDeliveryStage() {
  const { server, connect } = createTargetedDeliveryFake();
  trackConnections(server, (socket) => {
    socket.on('request-private', (value) => server.to(socket.id).emit('private', value));
  });
  const clients = [connect(), connect(), connect()];
  const deliveries = clients.map((client) => observe(client, 'private'));
  clients[2].emit('request-private', 'third only');
  await crossBarrier(clients[2], clients, 'after-private');
  assert.deepEqual(deliveries, [[], [], ['third only']]);
  return {
    id: 'targeted-delivery',
    passed: true,
    assertions: ['socket-id targeting reached only the requesting client'],
  };
}

async function runDisconnectCleanupStage() {
  const { server, connect } = createDisconnectFake();
  const room = 'stage-disconnect-cleanup';
  let disconnects = 0;
  trackConnections(server, (socket) => {
    socket.on('disconnect', () => {
      disconnects += 1;
    });
    socket.on('join-stage', (targetRoom) => socket.join(targetRoom));
    socket.on('publish', (value) => socket.to(room).emit('remaining-peer', value));
  });
  const clients = [connect(), connect(), connect()];
  const deliveries = clients.map((client) => observe(client, 'remaining-peer'));
  for (const client of clients) client.emit('join-stage', room);
  clients[2].disconnect();
  clients[0].emit('publish', 'after disconnect');
  await crossBarrier(clients[0], clients.slice(0, 2), 'after-disconnect-payload');
  assert.equal(disconnects, 1);
  assert.equal(clients[2].connected, false);
  assert.deepEqual(deliveries, [[], ['after disconnect'], []]);
  return {
    id: 'disconnect-cleanup',
    passed: true,
    assertions: [
      'disconnect was observed once',
      'post-disconnect routing reached only the remaining peer',
    ],
  };
}

const stageRunners = [
  runBaseStage,
  runMultipleClientsStage,
  runRoomBroadcastStage,
  runSenderExclusionStage,
  runAcknowledgementStage,
  runTargetedDeliveryStage,
  runDisconnectCleanupStage,
];

export async function runHandwrittenStages() {
  const results = [];
  for (const runStage of stageRunners) results.push(await runStage());
  return results;
}
