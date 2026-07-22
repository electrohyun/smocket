import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { observeDisconnect, receive, track } from './test-events';

const ctx = setupServer();

it('끊긴 소켓은 그 방의 emit을 더 이상 받지 않는다', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');

  const msg1 = track(client1, 'msg');
  const got2 = receive(client2, 'msg');

  const { disconnected } = observeDisconnect(socket1);
  client1.disconnect();
  await disconnected;

  ctx.io.to('room').emit('msg', 'hello');

  // A disconnected client cannot receive a marker, so the still-connected
  // member of the room is the reference point instead: once the message has
  // landed there, the emit has been delivered to whoever was going to get it.
  await expect(got2).resolves.toBe('hello');
  expect(msg1.received).toBe(false);
});

it('마지막 멤버가 끊기면 그 방은 adapter에서 사라진다', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  const socket1Id = socket1.id;

  // Reaching into the adapter is the only way to see a room that no longer
  // exists, since absence cannot be shown by delivery. This is internal state,
  // read here for observation only.
  const adapter = ctx.io.of('/').adapter;
  expect(adapter.rooms.has('room')).toBe(true);

  const { disconnected } = observeDisconnect(socket1);
  client1.disconnect();
  await disconnected;

  expect(adapter.rooms.has('room')).toBe(false);
  // Every socket also sits in a room named after its own id, and those are in
  // the same map, so the disconnect empties this socket's entries while the
  // other client keeps its own. Expecting rooms.size to reach 0 would fail.
  expect(adapter.rooms.has(socket1Id)).toBe(false);
  expect(adapter.rooms.has(socket2.id)).toBe(true);
});

it('재연결한 소켓은 이전 방에 자동으로 다시 들어가지 않는다', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');

  const { disconnected } = observeDisconnect(socket1);
  client1.disconnect();
  await disconnected;

  const reconnected = ctx.nextConnection();
  client1.connect();
  const socket1Again = await reconnected;

  // Same client, new socket and new id: the room membership did not come back.
  expect(socket1Again.id).not.toBe(socket1.id);
  expect(socket1Again.rooms.has('room')).toBe(false);

  const msg1 = track(client1, 'msg');
  const got2 = receive(client2, 'msg');

  ctx.io.to('room').emit('msg', 'hello');

  await expect(got2).resolves.toBe('hello');
  expect(msg1.received).toBe(false);
});

it('disconnecting 시점엔 방이 남아 있고 disconnect 시점엔 비어 있다', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join('room');
  const socket1Id = socket1.id;

  const { disconnecting, disconnected } = observeDisconnect(socket1);
  client1.disconnect();

  // This ordering is what makes "tell the room someone left" possible: the
  // rooms to notify are still readable at `disconnecting` and gone by
  // `disconnect`, so which event the work hangs off decides what it can see.
  const atDisconnecting = await disconnecting;
  expect(atDisconnecting.has('room')).toBe(true);
  expect(atDisconnecting.has(socket1Id)).toBe(true);

  const atDisconnect = await disconnected;
  expect(atDisconnect.size).toBe(0);
});
