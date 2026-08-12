import { expect, it } from 'vitest';
import type { ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

const ctx = setupServer();

it('io.of normalizes empty and bare static namespace names', () => {
  const root = ctx.io.of('/');
  const game = ctx.io.of('/game');

  expect(ctx.io.of('')).toBe(root);
  expect(root.name).toBe('/');
  expect(ctx.io.of('game')).toBe(game);
  expect(game.name).toBe('/game');
});

it('a registered static namespace admits the normalized harness name', async () => {
  const game = ctx.io.of('game');
  const { client, serverSocket } = await ctx.connectClient({ namespace: 'game' });

  expect(serverSocket.nsp).toBe(game);
  expect(serverSocket.nsp.name).toBe('/game');
  expect(client.id).toBe(serverSocket.id);
});

it('an unregistered static namespace is rejected without membership', async () => {
  const client = ctx.openUnregisteredClient('/private');
  const disconnected = track(client, 'disconnect');
  const outcome = await Promise.race([
    receive(client, 'connect').then(() => 'connect' as const),
    receive(client, 'connect_error'),
  ]);

  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toBe('Invalid namespace');
  expect(client.connected).toBe(false);
  expect(client.id).toBeUndefined();
  expect(disconnected.received).toBe(false);

  // Register only after the rejection marker has arrived. If the failed attempt had
  // created or joined anything, `of` would return that existing namespace and expose it.
  const namespace = ctx.io.of('/private');
  const adapter = namespace.adapter;
  const sids = (adapter as typeof adapter & { sids: Map<string, Set<string>> }).sids;
  expect(adapter.rooms.size).toBe(0);
  expect(sids.size).toBe(0);
});

it('a client can retry after its static namespace is registered', async () => {
  const client = ctx.openUnregisteredClient('/private');
  await receive(client, 'connect_error');

  const namespace = ctx.io.of('/private');
  const serverConnection = ctx.nextConnection('/private');
  const connected = receive(client, 'connect');
  client.connect();
  const [serverSocket] = await Promise.all([serverConnection, connected]);

  expect(serverSocket.nsp).toBe(namespace);
  expect(client.connected).toBe(true);
  expect(client.id).toBe(serverSocket.id);
});

it("io.of(nsp).on('connection') fires only for connections on that namespace", async () => {
  const seen = new Promise<ServerSocketContract>((resolve) => {
    ctx.io.of('/game').on('connection', (socket: ServerSocketContract) => resolve(socket));
  });
  // Connect on the default namespace first, and fully await it. Were that
  // connection to leak into the /game handler, `seen` would already be resolved
  // with a `/` socket, so the namespace assertion below would fail. This proves
  // the isolation by ordering rather than by waiting out a timeout.
  await ctx.connectClient();
  const { client } = await ctx.connectClient({ namespace: '/game' });

  const serverSocket = await seen;
  expect(serverSocket.nsp.name).toBe('/game');
  expect(serverSocket.id).toBe(client.id);
});

it('io.of(nsp).emit() goes only to clients in that namespace', async () => {
  const { client: rootClient, serverSocket: rootSocket } = await ctx.connectClient();
  const { client: gameClient } = await ctx.connectClient({ namespace: '/game' });

  const gotGame = receive(gameClient, 'msg');
  const msgRoot = track(rootClient, 'msg');
  const markerRoot = receive(rootClient, 'marker');

  ctx.io.of('/game').emit('msg', 'hello');
  rootSocket.emit('marker');

  await expect(gotGame).resolves.toBe('hello');
  await markerRoot;
  expect(msgRoot.received).toBe(false);
});

it('io.emit() on the default namespace does not reach other namespaces', async () => {
  const { client: rootClient } = await ctx.connectClient();
  const { client: gameClient, serverSocket: gameSocket } = await ctx.connectClient({
    namespace: '/game',
  });

  const gotRoot = receive(rootClient, 'msg');
  const msgGame = track(gameClient, 'msg');
  const markerGame = receive(gameClient, 'marker');

  // io.emit() is io.of('/').emit(), so "everyone" means everyone on `/`.
  ctx.io.emit('msg', 'hello');
  gameSocket.emit('marker');

  await expect(gotRoot).resolves.toBe('hello');
  await markerGame;
  expect(msgGame.received).toBe(false);
});

it('a room of the same name is separate per namespace', async () => {
  const { client: rootClient, serverSocket: rootSocket } = await ctx.connectClient();
  const { client: gameClient, serverSocket: gameSocket } = await ctx.connectClient({
    namespace: '/game',
  });
  await rootSocket.join('room');
  await gameSocket.join('room');

  // Each namespace keeps its own adapter, so the name collides without the
  // memberships ever meeting.
  expect(ctx.io.of('/').adapter.rooms.has('room')).toBe(true);
  expect(ctx.io.of('/game').adapter.rooms.has('room')).toBe(true);

  const gotGame = receive(gameClient, 'msg');
  const msgRoot = track(rootClient, 'msg');
  const markerRoot = receive(rootClient, 'marker');

  ctx.io.of('/game').to('room').emit('msg', 'hello');
  rootSocket.emit('marker');

  await expect(gotGame).resolves.toBe('hello');
  await markerRoot;
  expect(msgRoot.received).toBe(false); // in "room" too, on the other namespace
});

it('a client attached to two namespaces has a different socket id per namespace', async () => {
  const { client: rootClient, serverSocket: rootSocket } = await ctx.connectClient();
  const { client: gameClient, serverSocket: gameSocket } = await ctx.connectClient({
    namespace: '/game',
  });

  expect(rootSocket.nsp.name).toBe('/');
  expect(gameSocket.nsp.name).toBe('/game');
  expect(gameSocket.id).not.toBe(rootSocket.id);

  // Namespaces multiplex over one connection: the two clients share a manager
  // while holding a socket, and an id, per namespace.
  expect(rootClient.io).toBe(gameClient.io);
});

it('socket.broadcast stays inside the namespace of the sender', async () => {
  const { client: rootClient, serverSocket: rootSocket } = await ctx.connectClient();
  const { client: gameClient1, serverSocket: gameSocket1 } = await ctx.connectClient({
    namespace: '/game',
  });
  const { client: gameClient2 } = await ctx.connectClient({ namespace: '/game' });

  const gotGame2 = receive(gameClient2, 'msg');
  const msgRoot = track(rootClient, 'msg');
  const msgGame1 = track(gameClient1, 'msg');
  const markerRoot = receive(rootClient, 'marker');
  const markerGame1 = receive(gameClient1, 'marker');

  gameSocket1.broadcast.emit('msg', 'hello');
  rootSocket.emit('marker');
  gameSocket1.emit('marker');

  await expect(gotGame2).resolves.toBe('hello');
  await markerRoot;
  await markerGame1;
  expect(msgRoot.received).toBe(false); // another namespace
  expect(msgGame1.received).toBe(false); // sender excluded
});
