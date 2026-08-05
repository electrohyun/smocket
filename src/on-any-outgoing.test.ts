import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { observeDisconnect } from './test-events';

// `onAnyOutgoing` is the sending counterpart of `onAny`: it fires for events a socket
// sends, receiving the event name then the args. Measured against real socket.io 4.8.3:
// it runs synchronously at emit time (before the peer receives), fires per recipient for
// broadcasts (sender excluded), skips reserved lifecycle events, and strips a trailing ack
// from the args. It runs synchronously, so most assertions here need no await.
const ctx = setupServer();

it('a server-side outgoing catch-all fires for a direct emit with the event name and args', async () => {
  const { serverSocket } = await ctx.connectClient();
  const seen: Array<[unknown, unknown[]]> = [];
  serverSocket.onAnyOutgoing((event: unknown, ...args: unknown[]) => seen.push([event, args]));
  serverSocket.emit('greet', 'hi', 1);
  expect(seen).toEqual([['greet', ['hi', 1]]]);
});

it('a client-side outgoing catch-all fires for a client emit', async () => {
  const { client } = await ctx.connectClient();
  const seen: Array<[unknown, unknown[]]> = [];
  client.onAnyOutgoing((event: unknown, ...args: unknown[]) => seen.push([event, args]));
  client.emit('hello', 'x');
  expect(seen).toEqual([['hello', ['x']]]);
});

it('a connected volatile emit fires the outgoing catch-all, on both sides', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seenServer: Array<[unknown, unknown[]]> = [];
  const seenClient: Array<[unknown, unknown[]]> = [];
  serverSocket.onAnyOutgoing((e: unknown, ...args: unknown[]) => seenServer.push([e, args]));
  client.onAnyOutgoing((e: unknown, ...args: unknown[]) => seenClient.push([e, args]));
  serverSocket.volatile.emit('vev', 'payload');
  client.volatile.emit('cvev', 'x');
  expect(seenServer).toEqual([['vev', ['payload']]]);
  expect(seenClient).toEqual([['cvev', ['x']]]);
});

it('the outgoing catch-all runs before the peer receives the event', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  serverSocket.onAnyOutgoing(() => order.push('outgoing'));
  const received = new Promise<void>((resolve) =>
    client.on('ev', () => {
      order.push('received');
      resolve();
    }),
  );
  serverSocket.emit('ev');
  await received;
  expect(order).toEqual(['outgoing', 'received']);
});

it('io.emit fires the outgoing catch-all on every recipient socket', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  const seenA: Array<[unknown, unknown[]]> = [];
  const seenB: Array<[unknown, unknown[]]> = [];
  a.serverSocket.onAnyOutgoing((e: unknown, ...args: unknown[]) => seenA.push([e, args]));
  b.serverSocket.onAnyOutgoing((e: unknown, ...args: unknown[]) => seenB.push([e, args]));
  ctx.io.emit('bcast', 'payload');
  expect(seenA).toEqual([['bcast', ['payload']]]);
  expect(seenB).toEqual([['bcast', ['payload']]]);
});

it('a broadcast fires the outgoing catch-all on the reached socket, but not the sender', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  let aFired = 0;
  let bFired = 0;
  a.serverSocket.onAnyOutgoing(() => (aFired += 1));
  b.serverSocket.onAnyOutgoing(() => (bFired += 1));
  b.serverSocket.broadcast.emit('fromB', 'x');
  expect(aFired).toBe(1); // the packet reaches A, so A's outgoing catch-all fires
  expect(bFired).toBe(0); // B is the sender, excluded from its own broadcast
});

it('the outgoing catch-all does not fire for the disconnect lifecycle', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const events: unknown[] = [];
  serverSocket.onAnyOutgoing((event: unknown) => events.push(event));
  serverSocket.emit('regular');
  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;
  expect(events).toEqual(['regular']); // only the app event, no lifecycle packets
});

it('the ack callback is stripped from the outgoing catch-all args, for emit and emitWithAck', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: unknown[][] = [];
  serverSocket.onAnyOutgoing((...args: unknown[]) => seen.push(args));
  client.on('ask', (_q: unknown, ack: (v: string) => void) => ack('ok'));

  serverSocket.emit('ask', 'q1', () => undefined); // normal emit with a trailing ack
  const answer = await serverSocket.emitWithAck('ask', 'q2'); // and emitWithAck

  expect(answer).toBe('ok'); // the ack still round-trips
  expect(seen).toEqual([
    ['ask', 'q1'],
    ['ask', 'q2'],
  ]); // neither call surfaces the ack function
});

it('offAnyOutgoing(listener) removes one, offAnyOutgoing() removes all', async () => {
  const { serverSocket } = await ctx.connectClient();
  let a = 0;
  let b = 0;
  const onA = () => (a += 1);
  const onB = () => (b += 1);
  serverSocket.onAnyOutgoing(onA);
  serverSocket.onAnyOutgoing(onB);
  serverSocket.emit('e1');
  serverSocket.offAnyOutgoing(onA);
  serverSocket.emit('e2');
  serverSocket.offAnyOutgoing();
  serverSocket.emit('e3');
  expect(a).toBe(1);
  expect(b).toBe(2);
});

it('the client side carries offAnyOutgoing too', async () => {
  const { client } = await ctx.connectClient();
  let fired = 0;
  const listener = () => (fired += 1);
  client.onAnyOutgoing(listener);
  client.emit('e1');
  client.offAnyOutgoing(listener);
  client.emit('e2');
  expect(fired).toBe(1);
});
