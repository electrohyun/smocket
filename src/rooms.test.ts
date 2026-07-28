import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

const ctx = setupServer();

it('joining a room receives emits for that room', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join('room');

  const got = receive(client1, 'msg');
  ctx.io.to('room').emit('msg', 'hello');

  await expect(got).resolves.toBe('hello');
});

it('a client that has not joined does not receive emits for that room', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');

  const got1 = receive(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker2 = receive(client2, 'marker');

  ctx.io.to('room').emit('msg', 'hello');
  socket2.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await marker2;
  expect(msg2.received).toBe(false);
});

it('after leaving, a client no longer receives emits for that room', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');
  await socket2.leave('room');

  const got1 = receive(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker2 = receive(client2, 'marker');

  ctx.io.to('room').emit('msg', 'hello');
  socket2.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await marker2;
  expect(msg2.received).toBe(false);
});

it('a socket in several rooms receives the emits of each room', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join('roomA');
  await socket1.join('roomB');

  const gotA = receive(client1, 'toA');
  ctx.io.to('roomA').emit('toA', '1');
  await expect(gotA).resolves.toBe('1');

  const gotB = receive(client1, 'toB');
  ctx.io.to('roomB').emit('toB', '2');
  await expect(gotB).resolves.toBe('2');
});

it('every client in the same room receives (fan-out)', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');

  const got1 = receive(client1, 'msg');
  const got2 = receive(client2, 'msg');
  ctx.io.to('room').emit('msg', 'hello');

  await expect(got1).resolves.toBe('hello');
  await expect(got2).resolves.toBe('hello');
});
