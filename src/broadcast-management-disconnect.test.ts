import { expect, it } from 'vitest';
import type { ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

const ctx = setupServer();

function recordLifecycle(socket: ServerSocketContract, label: string, order: string[]): void {
  socket.once('disconnecting', (reason: string) => order.push(`${label}:disconnecting:${reason}`));
  socket.once('disconnect', (reason: string) => order.push(`${label}:disconnect:${reason}`));
}

it('io.disconnectSockets(false) synchronously closes every root Socket only', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });
  const order: string[] = [];
  recordLifecycle(root.serverSocket, 'root', order);
  const rootDisconnected = receive(root.client, 'disconnect');

  const result = ctx.io.disconnectSockets(false);

  expect(result).toBeUndefined();
  expect(order).toEqual([
    'root:disconnecting:server namespace disconnect',
    'root:disconnect:server namespace disconnect',
  ]);
  await expect(rootDisconnected).resolves.toBe('io server disconnect');
  expect(root.client.connected).toBe(false);
  expect(game.client.connected).toBe(true);
  const marker = receive(game.client, 'marker');
  game.serverSocket.emit('marker', 'still-connected');
  await expect(marker).resolves.toBe('still-connected');
});

it('disconnectSockets applies room union, exclusions, and snapshot selection', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  const both = await ctx.connectClient();
  const muted = await ctx.connectClient();
  await first.serverSocket.join('one');
  await second.serverSocket.join('two');
  await both.serverSocket.join(['one', 'two']);
  await muted.serverSocket.join(['one', 'muted']);
  const disconnected = [first, both, second].map(({ client }) => receive(client, 'disconnect'));

  ctx.io.to(['one', 'two']).except('muted').disconnectSockets();

  await expect(Promise.all(disconnected)).resolves.toEqual([
    'io server disconnect',
    'io server disconnect',
    'io server disconnect',
  ]);
  expect(first.serverSocket.rooms.size).toBe(0);
  expect(second.serverSocket.rooms.size).toBe(0);
  expect(both.serverSocket.rooms.size).toBe(0);
  expect(muted.client.connected).toBe(true);
  const marker = receive(muted.client, 'marker');
  muted.serverSocket.emit('marker', 'excluded');
  await expect(marker).resolves.toBe('excluded');
});

it('a Socket management operator excludes its sender from bulk disconnect', async () => {
  const sender = await ctx.connectClient();
  const selected = await ctx.connectClient();
  await sender.serverSocket.join('room');
  await selected.serverSocket.join('room');
  const selectedDisconnected = receive(selected.client, 'disconnect');

  sender.serverSocket.to('room').disconnectSockets();

  await expect(selectedDisconnected).resolves.toBe('io server disconnect');
  expect(sender.client.connected).toBe(true);
  const marker = receive(sender.client, 'marker');
  sender.serverSocket.emit('marker', 'sender');
  await expect(marker).resolves.toBe('sender');
});

it('disconnectSockets(true) closes each selected Manager group exactly once', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });
  const independentRoot = await ctx.connectClient();
  const order: string[] = [];
  recordLifecycle(root.serverSocket, 'root', order);
  recordLifecycle(game.serverSocket, 'game', order);
  recordLifecycle(independentRoot.serverSocket, 'independent', order);
  const disconnected = [root, game, independentRoot].map(({ client }) =>
    receive(client, 'disconnect'),
  );

  ctx.io.disconnectSockets(true);

  expect(order).toEqual([
    'root:disconnecting:server namespace disconnect',
    'root:disconnect:server namespace disconnect',
    'game:disconnecting:server namespace disconnect',
    'game:disconnect:server namespace disconnect',
    'independent:disconnecting:server namespace disconnect',
    'independent:disconnect:server namespace disconnect',
  ]);
  await expect(Promise.all(disconnected)).resolves.toEqual([
    'io server disconnect',
    'io server disconnect',
    'io server disconnect',
  ]);
});

it('disconnectSockets(true) cancels pending admission on a selected Manager', async () => {
  const root = await ctx.connectClient();
  let releaseMiddleware: (() => void) | undefined;
  let middlewareEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    middlewareEntered = resolve;
  });
  ctx.io.of('/auth').use((_socket, next) => {
    releaseMiddleware = next;
    middlewareEntered();
  });
  const pending = ctx.openClient({ namespace: '/auth' });
  const connected = track(pending, 'connect');
  const connectError = track(pending, 'connect_error');
  await entered;
  const rootDisconnected = receive(root.client, 'disconnect');

  ctx.io.to(root.serverSocket.id).disconnectSockets(true);
  await rootDisconnected;
  releaseMiddleware?.();

  const markerConnection = await ctx.connectClient({ namespace: '/marker', forceNew: true });
  const marker = receive(markerConnection.client, 'marker');
  markerConnection.serverSocket.emit('marker', 'settled');
  await expect(marker).resolves.toBe('settled');
  expect(connected.received).toBe(false);
  expect(connectError.received).toBe(false);
  expect(pending.connected).toBe(false);
});

it('bulk disconnect ignores delivery modifiers and stays namespace-local', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });
  await game.serverSocket.join('room');
  const gameDisconnected = receive(game.client, 'disconnect');

  ctx.io.of('/game').timeout(1).volatile.compress(false).to('room').disconnectSockets();

  await expect(gameDisconnected).resolves.toBe('io server disconnect');
  expect(root.client.connected).toBe(true);
});

it('dynamic parent bulk disconnect follows Socket.IO and does not reach children', async () => {
  const parent = ctx.io.of(/^\/tenant-/);
  const connection = new Promise<void>((resolve) => parent.once('connection', () => resolve()));
  const client = ctx.openClient({ namespace: '/tenant-a' });
  await Promise.all([connection, receive(client, 'connect')]);

  parent.disconnectSockets(true);
  parent.to('room').disconnectSockets(true);

  expect(client.connected).toBe(true);
  const child = await ctx.io.of('/tenant-a').fetchSockets();
  const marker = receive(client, 'marker');
  child[0]?.emit('marker', 'still-connected');
  await expect(marker).resolves.toBe('still-connected');
});
