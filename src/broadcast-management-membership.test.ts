import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { receive } from './test-events';

const ctx = setupServer();

it('io.socketsJoin synchronously joins every root Socket', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();

  const result = ctx.io.socketsJoin(['reviewers', 'active']);

  expect(result).toBeUndefined();
  expect(first.serverSocket.rooms).toEqual(new Set([first.serverSocket.id, 'reviewers', 'active']));
  expect(second.serverSocket.rooms).toEqual(
    new Set([second.serverSocket.id, 'reviewers', 'active']),
  );

  const leaveResult = ctx.io.socketsLeave('active');
  expect(leaveResult).toBeUndefined();
  expect(first.serverSocket.rooms).toEqual(new Set([first.serverSocket.id, 'reviewers']));
  expect(second.serverSocket.rooms).toEqual(new Set([second.serverSocket.id, 'reviewers']));
});

it('socketsJoin applies room union, deduplication, and exclusions', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  const both = await ctx.connectClient();
  const muted = await ctx.connectClient();
  await first.serverSocket.join('one');
  await second.serverSocket.join('two');
  await both.serverSocket.join(['one', 'two']);
  await muted.serverSocket.join(['one', 'muted']);

  ctx.io.to(['one', 'two']).except('muted').socketsJoin('selected');

  expect(first.serverSocket.rooms.has('selected')).toBe(true);
  expect(second.serverSocket.rooms.has('selected')).toBe(true);
  expect(both.serverSocket.rooms.has('selected')).toBe(true);
  expect(muted.serverSocket.rooms.has('selected')).toBe(false);
});

it('socketsLeave snapshots the selected set before mutating its target room', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  const outside = await ctx.connectClient();
  await first.serverSocket.join(['waiting', 'reviewers']);
  await second.serverSocket.join(['waiting', 'reviewers']);
  await outside.serverSocket.join('reviewers');

  const result = ctx.io.to('waiting').socketsLeave(['waiting', 'reviewers']);

  expect(result).toBeUndefined();
  expect(first.serverSocket.rooms).toEqual(new Set([first.serverSocket.id]));
  expect(second.serverSocket.rooms).toEqual(new Set([second.serverSocket.id]));
  expect(outside.serverSocket.rooms).toEqual(new Set([outside.serverSocket.id, 'reviewers']));
});

it('a Socket management operator excludes its sender from bulk membership', async () => {
  const sender = await ctx.connectClient();
  const selected = await ctx.connectClient();
  await sender.serverSocket.join('room');
  await selected.serverSocket.join('room');

  sender.serverSocket.to('room').socketsJoin('other');

  expect(sender.serverSocket.rooms.has('other')).toBe(false);
  expect(selected.serverSocket.rooms.has('other')).toBe(true);
});

it('bulk membership stays inside its namespace', async () => {
  const root = await ctx.connectClient();
  const game = await ctx.connectClient({ namespace: '/game' });

  ctx.io.of('/game').socketsJoin('game-only');

  expect(root.serverSocket.rooms.has('game-only')).toBe(false);
  expect(game.serverSocket.rooms.has('game-only')).toBe(true);
  ctx.io.of('/game').socketsLeave('game-only');
  expect(game.serverSocket.rooms.has('game-only')).toBe(false);
});

it('bulk membership ignores delivery modifiers', async () => {
  const selected = await ctx.connectClient();
  await selected.serverSocket.join('room');

  ctx.io.timeout(1).volatile.compress(false).to('room').socketsJoin('managed');
  ctx.io.timeout(1).volatile.compress(false).to('managed').socketsLeave('managed');

  expect(selected.serverSocket.rooms.has('managed')).toBe(false);
});

it('dynamic parent bulk membership follows Socket.IO and does not reach children', async () => {
  const parent = ctx.io.of(/^\/tenant-/);
  const connection = new Promise<void>((resolve) => parent.once('connection', () => resolve()));
  const client = ctx.openClient({ namespace: '/tenant-a' });
  await Promise.all([connection, receive(client, 'connect')]);
  const child = await ctx.io.of('/tenant-a').fetchSockets();

  parent.socketsJoin('parent-room');
  parent.to('other').socketsJoin('parent-room');
  parent.socketsLeave('parent-room');

  expect(child[0]?.rooms.has('parent-room')).toBe(false);
});
