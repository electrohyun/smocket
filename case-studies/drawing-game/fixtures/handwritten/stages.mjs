import assert from 'node:assert/strict';
import { Server, io } from './handwritten-socket.mjs';

const BARRIER_EVENT = 'handwritten-stage:barrier';
const MARKER_EVENT = 'handwritten-stage:marker';

function createStage(stageId, featureIds) {
  const origin = `http://${stageId}.handwritten.test`;
  const server = new Server(origin, { features: featureIds });
  server.on('connection', (socket) => {
    socket.on(BARRIER_EVENT, (token) => server.emit(MARKER_EVENT, token));
  });
  return { origin, server };
}

function waitForMarker(client, token) {
  return new Promise((resolve) => {
    client.onAny((event, value) => {
      if (event === MARKER_EVENT && value === token) resolve();
    });
  });
}

async function crossBarrier(sender, recipients, token) {
  const markers = recipients.map((client) => waitForMarker(client, token));
  sender.emit(BARRIER_EVENT, token);
  await Promise.all(markers);
}

function observe(client, event) {
  const values = [];
  client.on(event, (value) => values.push(value));
  return values;
}

async function runBaseStage() {
  const { origin, server } = createStage('base-single-client', []);
  try {
    server.on('connection', (socket) => {
      socket.on('request', () => socket.emit('response', { status: 'ready' }));
    });
    const client = io(origin);
    const responses = observe(client, 'response');
    client.emit('request', { ignoredByResponse: true });
    await crossBarrier(client, [client], 'after-base-response');
    assert.deepEqual(responses, [{ status: 'ready' }]);
    return {
      id: 'base-single-client',
      enabledFeatureIds: [],
      passed: true,
      assertions: ['one client connected', 'listener delivered one configured response'],
    };
  } finally {
    await server.close();
  }
}

async function runMultipleClientsStage() {
  const featureIds = ['multiple-clients'];
  const { origin, server } = createStage('multiple-clients', featureIds);
  try {
    const serverSockets = [];
    server.on('connection', (socket) => serverSockets.push(socket));
    const clients = [io(origin), io(origin), io(origin)];
    assert.equal(new Set(clients.map(({ id }) => id)).size, clients.length);
    assert.deepEqual(
      serverSockets.map(({ id }) => id),
      clients.map(({ id }) => id),
    );

    const deliveries = clients.map((client) => observe(client, 'direct'));
    serverSockets[1].emit('direct', 'second only');
    await crossBarrier(clients[1], clients, 'after-direct-delivery');
    assert.deepEqual(deliveries, [[], ['second only'], []]);
    return {
      id: 'multiple-clients',
      enabledFeatureIds: featureIds,
      passed: true,
      assertions: [
        'three socket ids were distinct',
        'direct delivery kept listener state separate',
      ],
    };
  } finally {
    await server.close();
  }
}

async function runRoomBroadcastStage() {
  const featureIds = ['multiple-clients', 'room-broadcast'];
  const { origin, server } = createStage('room-broadcast', featureIds);
  const room = 'stage-room-broadcast';
  try {
    server.on('connection', (socket) => {
      socket.on('join-stage', (targetRoom) => socket.join(targetRoom));
      socket.on('publish', (value) => server.to(room).emit('room-message', value));
    });
    const clients = [io(origin), io(origin), io(origin)];
    const deliveries = clients.map((client) => observe(client, 'room-message'));
    for (const client of clients) client.emit('join-stage', room);

    clients[0].emit('publish', 'room payload');
    await crossBarrier(clients[0], clients, 'after-room-payload');
    assert.deepEqual(deliveries, [['room payload'], ['room payload'], ['room payload']]);
    return {
      id: 'room-broadcast',
      enabledFeatureIds: featureIds,
      passed: true,
      assertions: ['room membership routed one payload to all three members'],
    };
  } finally {
    await server.close();
  }
}

async function runSenderExclusionStage() {
  const featureIds = ['multiple-clients', 'room-broadcast', 'sender-exclusion'];
  const { origin, server } = createStage('sender-exclusion', featureIds);
  const room = 'stage-sender-exclusion';
  try {
    server.on('connection', (socket) => {
      socket.on('join-stage', (targetRoom) => socket.join(targetRoom));
      socket.on('publish', (value) => socket.to(room).emit('peer-message', value));
    });
    const clients = [io(origin), io(origin), io(origin)];
    const deliveries = clients.map((client) => observe(client, 'peer-message'));
    for (const client of clients) client.emit('join-stage', room);

    clients[0].emit('publish', 'peer payload');
    await crossBarrier(clients[0], clients, 'after-peer-payload');
    assert.deepEqual(deliveries, [[], ['peer payload'], ['peer payload']]);
    return {
      id: 'sender-exclusion',
      enabledFeatureIds: featureIds,
      passed: true,
      assertions: ['the room sender was absent after a causally later marker'],
    };
  } finally {
    await server.close();
  }
}

async function runAcknowledgementStage() {
  const featureIds = ['acknowledgement'];
  const { origin, server } = createStage('acknowledgement', featureIds);
  try {
    server.on('connection', (socket) => {
      socket.on('request', (value, acknowledge) => acknowledge({ accepted: value === 'known' }));
    });
    const client = io(origin);
    const acknowledgement = await new Promise((resolve) =>
      client.emit('request', 'known', resolve),
    );
    assert.deepEqual(acknowledgement, { accepted: true });
    return {
      id: 'acknowledgement',
      enabledFeatureIds: featureIds,
      passed: true,
      assertions: ['the server returned one value through the client callback'],
    };
  } finally {
    await server.close();
  }
}

async function runTargetedDeliveryStage() {
  const featureIds = ['multiple-clients', 'targeted-delivery'];
  const { origin, server } = createStage('targeted-delivery', featureIds);
  try {
    server.on('connection', (socket) => {
      socket.on('request-private', (value) => server.to(socket.id).emit('private', value));
    });
    const clients = [io(origin), io(origin), io(origin)];
    const deliveries = clients.map((client) => observe(client, 'private'));
    clients[2].emit('request-private', 'third only');
    await crossBarrier(clients[2], clients, 'after-private');
    assert.deepEqual(deliveries, [[], [], ['third only']]);
    return {
      id: 'targeted-delivery',
      enabledFeatureIds: featureIds,
      passed: true,
      assertions: ['socket-id targeting reached only the requesting client'],
    };
  } finally {
    await server.close();
  }
}

async function runDisconnectCleanupStage() {
  const featureIds = [
    'multiple-clients',
    'room-broadcast',
    'sender-exclusion',
    'disconnect-cleanup',
  ];
  const { origin, server } = createStage('disconnect-cleanup', featureIds);
  const room = 'stage-disconnect-cleanup';
  try {
    let disconnects = 0;
    server.on('connection', (socket) => {
      socket.on('disconnect', () => {
        disconnects += 1;
      });
      socket.on('join-stage', (targetRoom) => socket.join(targetRoom));
      socket.on('publish', (value) => socket.to(room).emit('remaining-peer', value));
    });
    const clients = [io(origin), io(origin), io(origin)];
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
      enabledFeatureIds: featureIds,
      passed: true,
      assertions: [
        'disconnect was observed once',
        'post-disconnect routing reached only the remaining peer',
      ],
    };
  } finally {
    await server.close();
  }
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
