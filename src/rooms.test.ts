import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

const ctx = setupServer();

it('join하면 그 방의 emit을 받는다', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join('room');

  const got = receive(client1, 'msg');
  ctx.io.to('room').emit('msg', 'hello');

  await expect(got).resolves.toBe('hello');
});

it('join하지 않은 클라이언트는 그 방의 emit을 못 받는다', async () => {
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

it('leave하면 더 이상 그 방의 emit을 받지 못한다', async () => {
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

it('여러 방에 속하면 각 방의 emit을 모두 받는다', async () => {
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

it('같은 방의 여러 클라이언트가 모두 받는다 (팬아웃)', async () => {
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
