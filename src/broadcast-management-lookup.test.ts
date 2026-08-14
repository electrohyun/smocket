import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

const ctx = setupServer();

it('io.fetchSockets returns the existing local sockets in connection order', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  const third = await ctx.connectClient();
  const connected = [first, second, third];
  first.serverSocket.data.owner = 'first';

  const sockets = await ctx.io.fetchSockets();

  expect(sockets.map((socket) => socket.id)).toEqual(
    connected.map(({ serverSocket }) => serverSocket.id),
  );
  expect(sockets[0]).toBe(first.serverSocket);
  expect(sockets[0]?.data.owner).toBe('first');
  expect(sockets[0]?.handshake).toBe(first.serverSocket.handshake);
  expect(sockets[0]?.rooms).toBe(first.serverSocket.rooms);
});

it('fetchSockets applies room union, deduplication, and exclusions', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  const both = await ctx.connectClient();
  const muted = await ctx.connectClient();
  await first.serverSocket.join('one');
  await second.serverSocket.join('two');
  await both.serverSocket.join(['one', 'two']);
  await muted.serverSocket.join(['one', 'muted']);

  const sockets = await ctx.io.to(['one', 'two']).except('muted').fetchSockets();

  expect(sockets.map((socket) => socket.id)).toEqual([
    first.serverSocket.id,
    both.serverSocket.id,
    second.serverSocket.id,
  ]);
});

it('a socket management operator excludes its sender and named rooms', async () => {
  const sender = await ctx.connectClient();
  const selected = await ctx.connectClient();
  const muted = await ctx.connectClient();
  await sender.serverSocket.join('room');
  await selected.serverSocket.join('room');
  await muted.serverSocket.join(['room', 'muted']);

  const sockets = await sender.serverSocket.to('room').except('muted').fetchSockets();

  expect(sockets.map((socket) => socket.id)).toEqual([selected.serverSocket.id]);
});

it('fetchSockets stays inside its namespace even when room names match', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });
  await root.serverSocket.join('shared');
  await game.serverSocket.join('shared');

  const rootSockets = await ctx.io.to('shared').fetchSockets();
  const gameSockets = await ctx.io.of('/game').to('shared').fetchSockets();

  expect(rootSockets.map((socket) => socket.id)).toEqual([root.serverSocket.id]);
  expect(gameSockets.map((socket) => socket.id)).toEqual([game.serverSocket.id]);
});

it('lookup ignores timeout, volatile, and compression delivery modifiers', async () => {
  const selected = await ctx.connectClient();
  const muted = await ctx.connectClient();
  await selected.serverSocket.join('room');
  await muted.serverSocket.join(['room', 'muted']);

  const sockets = await ctx.io
    .timeout(1)
    .volatile.to('room')
    .except('muted')
    .compress(false)
    .fetchSockets();

  expect(sockets.map((socket) => socket.id)).toEqual([selected.serverSocket.id]);
});
