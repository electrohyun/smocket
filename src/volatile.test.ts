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

it('io.to(room).volatile and io.volatile.to(room) preserve the same target', async () => {
  const { client: member, serverSocket: memberSocket } = await ctx.connectClient();
  const { client: outside, serverSocket: outsideSocket } = await ctx.connectClient();
  await memberSocket.join('room');

  const narrowFirst = receive(member, 'narrow-first');
  const volatileFirst = receive(member, 'volatile-first');
  const outsideNarrow = track(outside, 'narrow-first');
  const outsideVolatile = track(outside, 'volatile-first');
  const marker = receive(outside, 'marker');

  ctx.io.to('room').volatile.emit('narrow-first', 'hello');
  await expect(narrowFirst).resolves.toBe('hello');
  ctx.io.volatile.to('room').emit('volatile-first', 'hello');
  await expect(volatileFirst).resolves.toBe('hello');
  outsideSocket.emit('marker');

  await marker;
  expect(outsideNarrow.received).toBe(false);
  expect(outsideVolatile.received).toBe(false);
});

it('namespace narrowing and volatile preserve each other in either order', async () => {
  const { client: member, serverSocket: memberSocket } = await ctx.connectClient({
    namespace: '/game',
  });
  const { client: outside, serverSocket: outsideSocket } = await ctx.connectClient({
    namespace: '/game',
  });
  await memberSocket.join('room');

  const narrowFirst = receive(member, 'narrow-first');
  const volatileFirst = receive(member, 'volatile-first');
  const outsideNarrow = track(outside, 'narrow-first');
  const outsideVolatile = track(outside, 'volatile-first');
  const marker = receive(outside, 'marker');
  const game = ctx.io.of('/game');

  game.to('room').volatile.emit('narrow-first', 'hello');
  await expect(narrowFirst).resolves.toBe('hello');
  game.volatile.to('room').emit('volatile-first', 'hello');
  await expect(volatileFirst).resolves.toBe('hello');
  outsideSocket.emit('marker');

  await marker;
  expect(outsideNarrow.received).toBe(false);
  expect(outsideVolatile.received).toBe(false);
});

it('socket.to(room).volatile and socket.volatile.to(room) keep sender exclusion', async () => {
  const { client: sender, serverSocket: senderSocket } = await ctx.connectClient();
  const { client: recipient, serverSocket: recipientSocket } = await ctx.connectClient();
  await senderSocket.join('room');
  await recipientSocket.join('room');

  const narrowFirst = receive(recipient, 'narrow-first');
  const volatileFirst = receive(recipient, 'volatile-first');
  const senderNarrow = track(sender, 'narrow-first');
  const senderVolatile = track(sender, 'volatile-first');
  const marker = receive(sender, 'marker');

  senderSocket.to('room').volatile.emit('narrow-first', 'hello');
  await expect(narrowFirst).resolves.toBe('hello');
  senderSocket.volatile.to('room').emit('volatile-first', 'hello');
  await expect(volatileFirst).resolves.toBe('hello');
  senderSocket.emit('marker');

  await marker;
  expect(senderNarrow.received).toBe(false);
  expect(senderVolatile.received).toBe(false);
});

it('socket.broadcast.volatile and socket.volatile.broadcast keep sender exclusion', async () => {
  const { client: sender, serverSocket: senderSocket } = await ctx.connectClient();
  const { client: recipient } = await ctx.connectClient();

  const narrowFirst = receive(recipient, 'narrow-first');
  const volatileFirst = receive(recipient, 'volatile-first');
  const senderNarrow = track(sender, 'narrow-first');
  const senderVolatile = track(sender, 'volatile-first');
  const marker = receive(sender, 'marker');

  senderSocket.broadcast.volatile.emit('narrow-first', 'hello');
  await expect(narrowFirst).resolves.toBe('hello');
  senderSocket.volatile.broadcast.emit('volatile-first', 'hello');
  await expect(volatileFirst).resolves.toBe('hello');
  senderSocket.emit('marker');

  await marker;
  expect(senderNarrow.received).toBe(false);
  expect(senderVolatile.received).toBe(false);
});

it('volatile stays immutable and survives to, in, except, and timeout in either order', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  const plain = receive(client, 'plain');
  const first = track(client, 'volatile-last');
  const second = track(client, 'volatile-first');
  const marker = receive(client, 'marker');

  ctx.io.on('connection', (socket: ServerSocketContract) => {
    const base = ctx.io.to(socket.id);
    const volatile = base.volatile;
    expect(volatile).not.toBe(base);
    expect(base.volatile).not.toBe(volatile);

    base.emit('plain', 'kept');
    base.in(socket.id).except('nobody').timeout(100).volatile.emit('volatile-last', 'dropped');
    volatile.in(socket.id).except('nobody').timeout(100).emit('volatile-first', 'dropped');
    socket.emit('marker', 'done');
  });

  client.connect();

  await expect(plain).resolves.toBe('kept');
  await expect(marker).resolves.toBe('done');
  expect(first.received).toBe(false);
  expect(second.received).toBe(false);
});

it('a volatile emit still carries an ack, which round-trips when delivered', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('q', (n: number, ack: (r: number) => void) => ack(n * 2));

  const answer = await new Promise((resolve) => {
    serverSocket.volatile.emit('q', 5, resolve);
  });

  expect(answer).toBe(10);
});

it('volatile emitWithAck delivers and fires outgoing catch-alls in both directions', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverOutgoing: string[] = [];
  const clientOutgoing: string[] = [];
  serverSocket.onAnyOutgoing((event) => serverOutgoing.push(String(event)));
  client.onAnyOutgoing((event) => clientOutgoing.push(String(event)));
  client.on('server-q', (n: number, ack: (r: number) => void) => ack(n * 2));
  serverSocket.on('client-q', (n: number, ack: (r: number) => void) => ack(n + 3));

  await expect(serverSocket.volatile.emitWithAck('server-q', 5)).resolves.toBe(10);
  await expect(client.volatile.emitWithAck('client-q', 7)).resolves.toBe(10);
  expect(serverOutgoing).toEqual(['server-q']);
  expect(clientOutgoing).toEqual(['client-q']);
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
  const volAck = track(client, 'vol-ack');
  const marker = receive(client, 'marker');

  ctx.io.on('connection', (socket: ServerSocketContract) => {
    socket.volatile.emit('vol', 'dropped'); // pre-connect: dropped
    void socket.volatile.emitWithAck('vol-ack'); // pre-connect: dropped, ack stays pending
    socket.emit('marker', 'ok'); // pre-connect: buffered, then delivered
  });

  client.connect();

  await expect(marker).resolves.toBe('ok');
  expect(vol.received).toBe(false);
  expect(volAck.received).toBe(false);
});

it('a volatile emit from a client still in the pre-connect window is dropped', async () => {
  // The mirror of the case above, from the client's side of the same window. `openClient`
  // returns before the connection completes (0004), so an emit issued right after it is in
  // the window: the volatile one is dropped and the plain one is buffered and replayed on
  // connect. The plain emit is the marker. Had the volatile one been buffered instead of
  // dropped it would sit ahead of the marker in the same queue and arrive first, so what the
  // server ends up seeing is the proof and no timeout is involved.
  const seen: string[] = [];
  const delivered = new Promise<void>((resolve) => {
    ctx.io.on('connection', (socket: ServerSocketContract) => {
      socket.on('vol', (value: string) => seen.push(`vol:${value}`));
      socket.on('vol-ack', () => seen.push('vol-ack'));
      socket.on('marker', (value: string) => {
        seen.push(`marker:${value}`);
        resolve();
      });
    });
  });

  const client = ctx.openClient();
  expect(client.connected).toBe(false);

  client.volatile.emit('vol', 'dropped'); // pre-connect: dropped
  // Real socket.io-client rejects this pending ack during fixture teardown.
  void client.volatile.emitWithAck('vol-ack').catch(() => undefined); // pre-connect: dropped
  client.emit('marker', 'ok'); // pre-connect: buffered, then delivered

  await delivered;
  expect(seen).toEqual(['marker:ok']);
});

// The reconnect window is the one left unasserted, and it is not the window above. A
// volatile emit on a client that connected and then disconnected is buffered by real
// socket.io-client and replayed on reconnect, which is reconnection behaviour and outside
// smocket's scope (docs/scope.md), so a dual-run case there would compare two different
// things. Before the first connection completes both targets drop, which is why that half
// is asserted.
