import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

// Narrowing a broadcast is not tied to the entry point: `to`, `in`, and `except` all
// live on the operator too, so the order they are written in does not change the
// recipients (#137). Every shape here was measured against real socket.io 4.8.3 first,
// then satisfied by smocket. Non-receipt is proven with the marker pattern.
const ctx = setupServer();

it('io.to(room).except(id) sends to the room minus that socket', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');

  const got1 = receive(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker2 = receive(client2, 'marker');

  ctx.io.to('room').except(socket2.id).emit('msg', 'hello');
  socket2.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await marker2;
  expect(msg2.received).toBe(false); // excluded after the room was chosen
});

it('the two orderings of to and except reach the same sockets', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');

  const first = receive(client1, 'to-then-except');
  const second = receive(client1, 'except-then-to');
  const excluded1 = track(client2, 'to-then-except');
  const excluded2 = track(client2, 'except-then-to');
  const marker2 = receive(client2, 'marker');

  ctx.io.to('room').except(socket2.id).emit('to-then-except', 'hello');
  ctx.io.except(socket2.id).to('room').emit('except-then-to', 'hello');
  socket2.emit('marker');

  await expect(first).resolves.toBe('hello');
  await expect(second).resolves.toBe('hello');
  await marker2;
  expect(excluded1.received).toBe(false);
  expect(excluded2.received).toBe(false);
});

it('chaining except twice excludes the union of both', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3, serverSocket: socket3 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');
  await socket3.join('room');

  const got3 = receive(client3, 'msg');
  const msg1 = track(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker1 = receive(client1, 'marker');
  const marker2 = receive(client2, 'marker');

  ctx.io.to('room').except(socket1.id).except(socket2.id).emit('msg', 'hello');
  socket1.emit('marker');
  socket2.emit('marker');

  await expect(got3).resolves.toBe('hello');
  await marker1;
  await marker2;
  // A second `except` adds to the exclusion rather than replacing the first one.
  expect(msg1.received).toBe(false);
  expect(msg2.received).toBe(false);
});

it('a chained call returns a new operator and leaves the original alone', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('roomA');
  await socket2.join('roomB');

  // Narrowing does not mutate the operator it is called on: each call returns a new
  // one, so an operator held in a variable stays the target it was built as. Both
  // calls below are discarded, which is what makes that observable.
  const operator = ctx.io.to('roomA');
  operator.to('roomB');
  operator.except('roomA');

  const got1 = receive(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker2 = receive(client2, 'marker');

  operator.emit('msg', 'hello');
  socket2.emit('marker');

  await expect(got1).resolves.toBe('hello'); // the discarded `except` did not remove roomA
  await marker2;
  expect(msg2.received).toBe(false); // the discarded `to` did not add roomB
});

it('socket.to(room).except(id) keeps excluding the sender', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3, serverSocket: socket3 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');
  await socket3.join('room');

  const got3 = receive(client3, 'msg');
  const msg1 = track(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker1 = receive(client1, 'marker');
  const marker2 = receive(client2, 'marker');

  socket1.to('room').except(socket2.id).emit('msg', 'hello');
  socket1.emit('marker');
  socket2.emit('marker');

  await expect(got3).resolves.toBe('hello');
  await marker1;
  await marker2;
  expect(msg1.received).toBe(false); // the sender, excluded by socket.to
  expect(msg2.received).toBe(false); // and the room named in except, on top of it
});

it('socket.broadcast.except(id) excludes the sender and that socket', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3 } = await ctx.connectClient();

  const got3 = receive(client3, 'msg');
  const msg1 = track(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker1 = receive(client1, 'marker');
  const marker2 = receive(client2, 'marker');

  socket1.broadcast.except(socket2.id).emit('msg', 'hello');
  socket1.emit('marker');
  socket2.emit('marker');

  await expect(got3).resolves.toBe('hello');
  await marker1;
  await marker2;
  expect(msg1.received).toBe(false);
  expect(msg2.received).toBe(false);
});

it('in() on the operator is an alias for to()', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3, serverSocket: socket3 } = await ctx.connectClient();
  await socket1.join('roomA');
  await socket2.join('roomB');

  const got1 = receive(client1, 'msg');
  const got2 = receive(client2, 'msg');
  const msg3 = track(client3, 'msg');
  const marker3 = receive(client3, 'marker');

  ctx.io.to('roomA').in('roomB').emit('msg', 'hello');
  socket3.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await expect(got2).resolves.toBe('hello');
  await marker3;
  expect(msg3.received).toBe(false); // in neither room
});

it('io.of(nsp).to(room).except(id) narrows within that namespace', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient({
    namespace: '/game',
  });
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient({
    namespace: '/game',
  });
  await socket1.join('room');
  await socket2.join('room');

  const got1 = receive(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker2 = receive(client2, 'marker');

  ctx.io.of('/game').to('room').except(socket2.id).emit('msg', 'hello');
  socket2.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await marker2;
  expect(msg2.received).toBe(false);
});
