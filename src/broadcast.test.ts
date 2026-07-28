import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { count, receive, track } from './test-events';

const ctx = setupServer();

it('socket.broadcast.emit goes to everyone except the sender', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2 } = await ctx.connectClient();

  const got2 = receive(client2, 'msg');
  const msg1 = track(client1, 'msg');
  const marker1 = receive(client1, 'marker');

  socket1.broadcast.emit('msg', 'hello');
  socket1.emit('marker');

  await expect(got2).resolves.toBe('hello');
  await marker1;
  expect(msg1.received).toBe(false); // sender excluded
});

it('io.except(room) goes to everyone not in that room', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2 } = await ctx.connectClient();
  await socket1.join('room');

  const got2 = receive(client2, 'msg');
  const msg1 = track(client1, 'msg');
  const marker1 = receive(client1, 'marker');

  ctx.io.except('room').emit('msg', 'hello');
  socket1.emit('marker');

  await expect(got2).resolves.toBe('hello');
  await marker1;
  expect(msg1.received).toBe(false); // room member excluded
});

it('to() with an array delivers to the union of the rooms', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3, serverSocket: socket3 } = await ctx.connectClient();
  await socket1.join('roomA');
  await socket2.join('roomB');
  // client3 is in neither room

  const got1 = receive(client1, 'msg');
  const got2 = receive(client2, 'msg');
  const out3 = track(client3, 'msg');
  const marker3 = receive(client3, 'marker');

  ctx.io.to(['roomA', 'roomB']).emit('msg', 'hello');
  socket3.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await expect(got2).resolves.toBe('hello');
  await marker3;
  expect(out3.received).toBe(false);
});

it('chaining to() delivers to the union of the rooms', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3, serverSocket: socket3 } = await ctx.connectClient();
  await socket1.join('roomA');
  await socket2.join('roomB');

  const got1 = receive(client1, 'msg');
  const got2 = receive(client2, 'msg');
  const out3 = track(client3, 'msg');
  const marker3 = receive(client3, 'marker');

  ctx.io.to('roomA').to('roomB').emit('msg', 'hello');
  socket3.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await expect(got2).resolves.toBe('hello');
  await marker3;
  expect(out3.received).toBe(false);
});

it('the array union delivers only once even when a socket is in several rooms', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join('roomA');
  await socket1.join('roomB');

  const counter = count(client1, 'msg');
  const done = receive(client1, 'marker');

  ctx.io.to(['roomA', 'roomB']).emit('msg', 'once');
  socket1.emit('marker');

  await done;
  expect(counter.count).toBe(1); // deduplicated
});

it('the chained union delivers only once even when a socket is in several rooms', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join('roomA');
  await socket1.join('roomB');

  const counter = count(client1, 'msg');
  const done = receive(client1, 'marker');

  ctx.io.to('roomA').to('roomB').emit('msg', 'once');
  socket1.emit('marker');

  await done;
  expect(counter.count).toBe(1); // a per-call delivery would make this 2 and fail
});

it('in() is an alias for to()', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');

  const got1 = receive(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker2 = receive(client2, 'marker');

  ctx.io.in('room').emit('msg', 'hello');
  socket2.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await marker2;
  expect(msg2.received).toBe(false);
});

it('socket.except(room) excludes both the sender and that room', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3 } = await ctx.connectClient();
  await socket2.join('room');

  const got3 = receive(client3, 'msg');
  const msg1 = track(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker1 = receive(client1, 'marker');
  const marker2 = receive(client2, 'marker');

  socket1.except('room').emit('msg', 'hello');
  socket1.emit('marker');
  socket2.emit('marker');

  await expect(got3).resolves.toBe('hello');
  await marker1;
  await marker2;
  expect(msg1.received).toBe(false); // sender excluded
  expect(msg2.received).toBe(false); // room member excluded
});

it('io.to(socketId) delivers only to that socket (its own id room)', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();

  const got2 = receive(client2, 'msg');
  const msg1 = track(client1, 'msg');
  const marker1 = receive(client1, 'marker');

  ctx.io.to(socket2.id).emit('msg', 'hello');
  socket1.emit('marker');

  await expect(got2).resolves.toBe('hello');
  await marker1;
  expect(msg1.received).toBe(false);
});

it('socket.rooms is server-only and reflects its own id and join/leave', async () => {
  const { serverSocket: socket1 } = await ctx.connectClient();

  // socket.rooms is a server-only concept; right after connecting it holds only the socket's own id room.
  expect(socket1.rooms).toBeInstanceOf(Set);
  expect(socket1.rooms.has(socket1.id)).toBe(true);
  expect(socket1.rooms.size).toBe(1);

  await socket1.join('room');
  expect(socket1.rooms.has('room')).toBe(true);
  expect(socket1.rooms.has(socket1.id)).toBe(true);

  await socket1.leave('room');
  expect(socket1.rooms.has('room')).toBe(false);
  expect(socket1.rooms.has(socket1.id)).toBe(true);
});

it('socket.to(room) excludes the sender even when the sender is a member of that room', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3, serverSocket: socket3 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');
  // client3 is outside the room

  const got2 = receive(client2, 'msg');
  const msg1 = track(client1, 'msg');
  const msg3 = track(client3, 'msg');
  const marker1 = receive(client1, 'marker');
  const marker3 = receive(client3, 'marker');

  socket1.to('room').emit('msg', 'hello');
  socket1.emit('marker');
  socket3.emit('marker');

  await expect(got2).resolves.toBe('hello');
  await marker1;
  await marker3;
  // The sender is in the room, so io.to("room") would have included it here.
  // socket.to("room") is the same as socket.broadcast.to("room"): room minus sender.
  expect(msg1.received).toBe(false);
  expect(msg3.received).toBe(false); // outside the room
});

it('io.emit() delivers to everyone connected', async () => {
  const { client: client1 } = await ctx.connectClient();
  const { client: client2 } = await ctx.connectClient();
  const { client: client3 } = await ctx.connectClient();

  const got1 = receive(client1, 'msg');
  const got2 = receive(client2, 'msg');
  const got3 = receive(client3, 'msg');

  // No sender to exclude, so this needs no marker: every client is expected to
  // receive, and the awaits below would time out if one did not.
  ctx.io.emit('msg', 'hello');

  await expect(got1).resolves.toBe('hello');
  await expect(got2).resolves.toBe('hello');
  await expect(got3).resolves.toBe('hello');
});
