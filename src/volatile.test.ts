import { expect, it } from 'vitest';
import type { ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { observeDisconnect, receive, track } from './test-events';

const ctx = setupServer();

// 0016: `volatile` is a plain emit while the socket is connected and is dropped only when it
// is sent in the pre-connect window (0004). The steady-state cases prove the "plain emit"
// half; the two drop cases prove the window, both proven with the marker pattern rather than
// a timeout (a later normal event is shown to arrive while the volatile one never did).

it('a volatile emit is delivered on a connected socket (server to client)', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const got = receive(client, 'vol');
  serverSocket.volatile.emit('vol', 'hi');
  await expect(got).resolves.toBe('hi');
});

it('a volatile emit is delivered on a connected socket (client to server)', async () => {
  // `.volatile` is meaningful in both directions; on a connected socket it is a plain emit.
  const { client, serverSocket } = await ctx.connectClient();
  const got = new Promise((resolve) => serverSocket.on('vol', resolve));
  client.volatile.emit('vol', 'hi');
  await expect(got).resolves.toBe('hi');
});

it('io.volatile.to(room) routes to the room like a normal broadcast in steady state', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');

  const got1 = receive(client1, 'msg');
  const msg2 = track(client2, 'msg');
  const marker2 = receive(client2, 'marker');

  ctx.io.volatile.to('room').emit('msg', 'hello');
  socket2.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await marker2;
  expect(msg2.received).toBe(false); // outside the room
});

it('socket.volatile.broadcast reaches everyone except the sender in steady state', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2 } = await ctx.connectClient();

  const got2 = receive(client2, 'msg');
  const msg1 = track(client1, 'msg');
  const marker1 = receive(client1, 'marker');

  socket1.volatile.broadcast.emit('msg', 'hello');
  socket1.emit('marker');

  await expect(got2).resolves.toBe('hello');
  await marker1;
  expect(msg1.received).toBe(false); // sender excluded
});

it('a volatile emit still carries an ack, which round-trips when delivered', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('q', (n: number, ack: (r: number) => void) => ack(n * 2));

  const answer = await new Promise((resolve) => {
    serverSocket.volatile.emit('q', 5, resolve);
  });

  expect(answer).toBe(10);
});

it('a volatile emit to a recipient still in the pre-connect window is dropped', async () => {
  // Inside the connection handler the paired client has not yet completed its connection
  // (0004), so a volatile emit to it is dropped while a normal one is delivered. Reached
  // through a reconnect so the client and its listeners already exist; the marker proves
  // non-receipt without a timeout.
  const { client, serverSocket } = await ctx.connectClient();

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  const vol = track(client, 'vol');
  const marker = receive(client, 'marker');

  ctx.io.on('connection', (socket: ServerSocketContract) => {
    socket.volatile.emit('vol', 'dropped'); // pre-connect: dropped
    socket.emit('marker', 'ok'); // pre-connect: buffered, then delivered
  });

  client.connect();

  await expect(marker).resolves.toBe('ok');
  expect(vol.received).toBe(false);
});

// The client-side pre-connect window (a volatile emit before the client's own connection
// opens) is the mirror of the case above, but it is not cleanly reachable through the shared
// harness: `connectClient` only hands back a client that has already connected, and the one
// public route into a disconnected client, a reconnect, is not that window. Measured against
// real socket.io-client 4.8.3, a volatile emit issued on a disconnected client is buffered and
// delivered on reconnect (reconnection buffering, out of smocket's scope), not dropped, so a
// dual-run test of it would compare two different behaviours. The server-side case above is
// the one place the 0016 window is observable on both targets, so it is the one asserted here.
