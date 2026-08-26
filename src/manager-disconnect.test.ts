import { expect, it } from 'vitest';
import type { ClientSocketContract, ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

const ctx = setupServer();

function recordServerLifecycle(socket: ServerSocketContract, label: string, order: string[]): void {
  socket.once('disconnecting', (reason: string) => order.push(`${label}:disconnecting:${reason}`));
  socket.once('disconnect', (reason: string) => order.push(`${label}:disconnect:${reason}`));
}

function recordClientDisconnect(
  client: ClientSocketContract,
  label: string,
  order: string[],
): Promise<string> {
  return new Promise((resolve) =>
    client.once('disconnect', (reason: string) => {
      order.push(`${label}:client:${reason}`);
      resolve(reason);
    }),
  );
}

it('disconnect(false) closes only its namespace socket', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });
  const order: string[] = [];
  recordServerLifecycle(root.serverSocket, 'root', order);
  const rootDisconnected = recordClientDisconnect(root.client, 'root', order);

  expect(root.client.io).toBe(game.client.io);
  expect(root.serverSocket.disconnect(false)).toBe(root.serverSocket);
  expect(order).toEqual([
    'root:disconnecting:server namespace disconnect',
    'root:disconnect:server namespace disconnect',
  ]);

  await expect(rootDisconnected).resolves.toBe('io server disconnect');
  expect(root.client.connected).toBe(false);
  expect(root.client.id).toBeUndefined();
  expect(game.client.connected).toBe(true);

  const marker = receive(game.client, 'marker');
  game.serverSocket.emit('marker', 'still-connected');
  await expect(marker).resolves.toBe('still-connected');
});

it('disconnect(true) is inert after that server socket disconnects with false', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });
  const rootDisconnected = recordClientDisconnect(root.client, 'root', []);

  expect(root.serverSocket.disconnect(false)).toBe(root.serverSocket);
  expect(root.serverSocket.disconnect(true)).toBe(root.serverSocket);
  await rootDisconnected;

  const marker = receive(game.client, 'marker');
  game.serverSocket.emit('marker', 'still-connected');
  await expect(marker).resolves.toBe('still-connected');
  expect(game.client.connected).toBe(true);
  expect(game.serverSocket.rooms.has(game.serverSocket.id)).toBe(true);
});

it('disconnect(true) closes shared namespaces in connection order before returning', async () => {
  const game = await ctx.connectClient({ namespace: '/game' });
  const root = await ctx.connectClient();
  const order: string[] = [];
  recordServerLifecycle(game.serverSocket, 'game', order);
  recordServerLifecycle(root.serverSocket, 'root', order);
  const gameDisconnected = recordClientDisconnect(game.client, 'game', order);
  const rootDisconnected = recordClientDisconnect(root.client, 'root', order);

  expect(root.serverSocket.disconnect(true)).toBe(root.serverSocket);
  expect(order).toEqual([
    'game:disconnecting:server namespace disconnect',
    'game:disconnect:server namespace disconnect',
    'root:disconnecting:server namespace disconnect',
    'root:disconnect:server namespace disconnect',
  ]);

  await expect(Promise.all([gameDisconnected, rootDisconnected])).resolves.toEqual([
    'io server disconnect',
    'io server disconnect',
  ]);
  expect(order).toEqual([
    'game:disconnecting:server namespace disconnect',
    'game:disconnect:server namespace disconnect',
    'root:disconnecting:server namespace disconnect',
    'root:disconnect:server namespace disconnect',
    'game:client:io server disconnect',
    'root:client:io server disconnect',
  ]);
  expect(root.client.connected).toBe(false);
  expect(game.client.connected).toBe(false);
  expect(root.serverSocket.rooms.size).toBe(0);
  expect(game.serverSocket.rooms.size).toBe(0);
});

it('disconnect(true) from a connection handler includes the initiator and isolates opt-outs', async () => {
  const root = await ctx.connectClient();
  const forcedConnection = ctx.nextConnection('/forced');
  const forcedClient = ctx.openClient({ namespace: '/forced', forceNew: true });
  const [forcedSocket] = await Promise.all([forcedConnection, receive(forcedClient, 'connect')]);
  const soloConnection = ctx.nextConnection('/solo');
  const soloClient = ctx.openClient({ namespace: '/solo', multiplex: false });
  const [soloSocket] = await Promise.all([soloConnection, receive(soloClient, 'connect')]);
  const order: string[] = [];
  recordServerLifecycle(root.serverSocket, 'root', order);
  const rootDisconnected = recordClientDisconnect(root.client, 'root', order);
  let orderAtReturn: string[] = [];
  const handled = new Promise<ServerSocketContract>((resolve) => {
    ctx.io.of('/game').on('connection', (socket: ServerSocketContract) => {
      recordServerLifecycle(socket, 'game', order);
      expect(socket.disconnect(true)).toBe(socket);
      orderAtReturn = [...order];
      resolve(socket);
    });
  });

  const gameClient = ctx.openClient({ namespace: '/game' });
  const gameDisconnected = recordClientDisconnect(gameClient, 'game', order);
  const gameSocket = await handled;

  expect(orderAtReturn).toEqual([
    'root:disconnecting:server namespace disconnect',
    'root:disconnect:server namespace disconnect',
    'game:disconnecting:server namespace disconnect',
    'game:disconnect:server namespace disconnect',
  ]);
  await expect(Promise.all([rootDisconnected, gameDisconnected])).resolves.toEqual([
    'io server disconnect',
    'io server disconnect',
  ]);
  expect(root.client.connected).toBe(false);
  expect(gameClient.connected).toBe(false);
  expect(gameSocket.rooms.size).toBe(0);

  for (const connection of [
    { client: forcedClient, socket: forcedSocket },
    { client: soloClient, socket: soloSocket },
  ]) {
    expect(connection.client.io).not.toBe(root.client.io);
    const marker = receive(connection.client, 'marker');
    connection.socket.emit('marker', connection.socket.nsp.name);
    await expect(marker).resolves.toBe(connection.socket.nsp.name);
    expect(connection.client.connected).toBe(true);
    expect(connection.socket.rooms.has(connection.socket.id)).toBe(true);
  }
});

it('disconnect(true) cancels pending namespace admission on the shared Manager', async () => {
  let releaseMiddleware: (() => void) | undefined;
  let pendingServerSocket: ServerSocketContract | undefined;
  let markMiddlewareEntered!: () => void;
  const middlewareEntered = new Promise<void>((resolve) => {
    markMiddlewareEntered = resolve;
  });
  ctx.io.of('/auth').use(async (socket, next) => {
    pendingServerSocket = socket;
    await socket.join('temporary-admission');
    releaseMiddleware = () => next();
    markMiddlewareEntered();
  });

  const pendingClient = ctx.openClient({ namespace: '/auth' });
  const connects = track(pendingClient, 'connect');
  const connectErrors = track(pendingClient, 'connect_error');
  await middlewareEntered;

  const root = await ctx.connectClient();
  expect(pendingClient.io).toBe(root.client.io);
  const rootDisconnected = recordClientDisconnect(root.client, 'root', []);
  root.serverSocket.disconnect(true);
  await rootDisconnected;

  releaseMiddleware?.();

  // A fresh, independent Manager is the later marker. Its completed connection and
  // direct delivery prove the released middleware callback had a chance to run without
  // relying on a timeout to establish non-receipt on the cancelled client.
  const markerConnection = await ctx.connectClient({ namespace: '/marker', forceNew: true });
  const marker = receive(markerConnection.client, 'marker');
  markerConnection.serverSocket.emit('marker', 'settled');
  await expect(marker).resolves.toBe('settled');

  expect(connects.received).toBe(false);
  expect(connectErrors.received).toBe(false);
  expect(pendingClient.connected).toBe(false);
  expect(pendingServerSocket?.rooms.size).toBe(0);
  expect(ctx.io.of('/auth').adapter.rooms.has('temporary-admission')).toBe(false);
});

it('reentrant client disconnects do not duplicate shared Manager teardown', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });
  const rootReasons: string[] = [];
  const gameReasons: string[] = [];
  root.client.on('disconnect', (reason: string) => rootReasons.push(reason));
  game.client.on('disconnect', (reason: string) => gameReasons.push(reason));
  root.serverSocket.once('disconnecting', () => {
    root.client.disconnect();
    game.client.disconnect();
  });

  root.serverSocket.disconnect(true);

  // The independent marker advances beyond the deferred server-initiated client
  // callbacks. Those callbacks must observe the reentrant client teardown and no-op.
  const markerConnection = await ctx.connectClient({ namespace: '/marker', forceNew: true });
  const marker = receive(markerConnection.client, 'marker');
  markerConnection.serverSocket.emit('marker', 'settled');
  await expect(marker).resolves.toBe('settled');

  expect(rootReasons).toEqual(['io client disconnect']);
  expect(gameReasons).toEqual(['io client disconnect']);
  expect(root.client.connected).toBe(false);
  expect(game.client.connected).toBe(false);
});

it('disconnect(true) leaves duplicate and opted-out Managers connected', async () => {
  const root = await ctx.connectClient();
  const shared = await ctx.connectClient({ namespace: '/game' });
  const duplicate = await ctx.connectClient({ namespace: '/game' });
  const forced = await ctx.connectClient({ namespace: '/forced', forceNew: true });
  const unmultiplexed = await ctx.connectClient({ namespace: '/solo', multiplex: false });

  expect(root.client.io).toBe(shared.client.io);
  expect(duplicate.client.io).not.toBe(root.client.io);
  expect(forced.client.io).not.toBe(root.client.io);
  expect(unmultiplexed.client.io).not.toBe(root.client.io);
  expect(forced.client.io).not.toBe(unmultiplexed.client.io);

  const rootDisconnected = recordClientDisconnect(root.client, 'root', []);
  const sharedDisconnected = recordClientDisconnect(shared.client, 'shared', []);
  root.serverSocket.disconnect(true);
  await Promise.all([rootDisconnected, sharedDisconnected]);

  for (const connection of [duplicate, forced, unmultiplexed]) {
    expect(connection.client.connected).toBe(true);
    const marker = receive(connection.client, 'marker');
    connection.serverSocket.emit('marker', connection.serverSocket.nsp.name);
    await expect(marker).resolves.toBe(connection.serverSocket.nsp.name);
  }
});

it('shared Manager teardown rejects client acks and permits explicit reconnect', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });
  await root.serverSocket.join('root-room');
  await game.serverSocket.join('game-room');
  root.serverSocket.on('slow', () => undefined);
  game.serverSocket.on('slow', () => undefined);
  const rootAck = root.client.emitWithAck('slow');
  const gameAck = game.client.emitWithAck('slow');
  const rootAckRejected = expect(rootAck).rejects.toThrow('disconnected');
  const gameAckRejected = expect(gameAck).rejects.toThrow('disconnected');
  const rootId = root.serverSocket.id;
  const gameId = game.serverSocket.id;
  const rootDisconnected = recordClientDisconnect(root.client, 'root', []);
  const gameDisconnected = recordClientDisconnect(game.client, 'game', []);

  root.serverSocket.disconnect(true);
  await Promise.all([rootDisconnected, gameDisconnected]);

  await Promise.all([rootAckRejected, gameAckRejected]);
  expect(root.serverSocket.rooms.size).toBe(0);
  expect(game.serverSocket.rooms.size).toBe(0);

  const nextRoot = ctx.nextConnection();
  expect(root.client.connect()).toBe(root.client);
  const rootAgain = await nextRoot;
  const nextGame = ctx.nextConnection('/game');
  expect(game.client.connect()).toBe(game.client);
  const gameAgain = await nextGame;

  expect(root.client.io).toBe(game.client.io);
  expect(rootAgain.id).not.toBe(rootId);
  expect(gameAgain.id).not.toBe(gameId);
  expect(rootAgain.rooms.has('root-room')).toBe(false);
  expect(gameAgain.rooms.has('game-room')).toBe(false);
});

it('disconnect(true) from a stale server socket leaves the reconnect connected', async () => {
  const first = await ctx.connectClient();
  const disconnected = recordClientDisconnect(first.client, 'first', []);
  first.serverSocket.disconnect(false);
  await disconnected;

  const reconnected = ctx.nextConnection();
  const clientConnected = new Promise<void>((resolve) =>
    first.client.once('connect', () => resolve()),
  );
  first.client.connect();
  const [currentSocket] = await Promise.all([reconnected, clientConnected]);

  expect(first.client.connected).toBe(true);
  expect(first.serverSocket.disconnect(true)).toBe(first.serverSocket);
  expect(first.client.connected).toBe(true);
  const marker = receive(first.client, 'marker');
  currentSocket.emit('marker', 'current-connection');
  await expect(marker).resolves.toBe('current-connection');
  expect(first.client.connected).toBe(true);
  expect(currentSocket.rooms.has(currentSocket.id)).toBe(true);
});
