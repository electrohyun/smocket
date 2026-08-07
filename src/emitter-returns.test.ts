import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

const ctx = setupServer();

// What `emit` and the listener methods hand back. Every case here was read off a real
// socket.io server first and the contract was written to match, so these run on both
// targets and fail on either one that drifts.
//
// The shape is not uniform, which is the point of pinning it. The client's `emit` returns
// the socket so calls chain; every server-side `emit` returns `true` instead. The listener
// methods return the socket on both sides.

it('the client emit returns the socket, so it chains', async () => {
  const { client } = await ctx.connectClient();
  expect(client.emit('a', 1)).toBe(client);
});

it('a buffered emit returns the socket too, before the connection completes', async () => {
  // The pre-connect branch is a separate path: the emit is queued rather than sent, and
  // it still answers with the socket, so chaining does not depend on being connected yet.
  const client = ctx.openClient();
  expect(client.connected).toBe(false);
  expect(client.emit('a', 1)).toBe(client);
});

it('the server socket emit returns true rather than the socket', async () => {
  const { serverSocket } = await ctx.connectClient();
  const returned = serverSocket.emit('a', 1);
  expect(returned).toBe(true);
  expect(returned).not.toBe(serverSocket);
});

it('the server emit returns true', async () => {
  await ctx.connectClient();
  expect(ctx.io.emit('a', 1)).toBe(true);
});

it('a namespace emit returns true', async () => {
  await ctx.connectClient();
  expect(ctx.io.of('/').emit('a', 1)).toBe(true);
});

it('a broadcast emit returns true', async () => {
  const { serverSocket } = await ctx.connectClient();
  await serverSocket.join('r');
  expect(ctx.io.to('r').emit('a', 1)).toBe(true);
});

it('a timed broadcast emit returns true', async () => {
  const { serverSocket } = await ctx.connectClient();
  await serverSocket.join('r');
  expect(
    ctx.io
      .timeout(50)
      .to('r')
      .emit('a', 1, () => {}),
  ).toBe(true);
});

it('a timed server socket emit returns true, where the client one chains', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  expect(serverSocket.timeout(50).emit('a', 1, () => {})).toBe(true);

  // The client side hands back the emitter it was called on. Which object that is differs
  // between the two targets and is not asserted: real socket.io decorates and returns the
  // socket, smocket builds a per-call wrapper. What both promise is that the call chains.
  const timed = client.timeout(50);
  expect(timed.emit('a', 1, () => {})).toBe(timed);
});

it('a volatile emit follows its own side: true on the server, the socket on the client', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  expect(serverSocket.volatile.emit('a', 1)).toBe(true);
  const view = client.volatile;
  expect(view.emit('a', 1)).toBe(view);
});

it('a dropped volatile emit still returns the emitter it was called on', async () => {
  // The pre-connect window (0016) is the branch where a client volatile emit is dropped
  // instead of sent. The packet goes nowhere and the call still chains, so returning is not
  // conditional on delivery. Only the return value is asserted here; whether the emit is
  // dropped is volatile.test.ts's subject.
  const client = ctx.openClient();
  expect(client.connected).toBe(false);

  const view = client.volatile;
  expect(view.emit('vol', 'dropped')).toBe(view);
});

it('the client listener methods return the socket, so they chain', async () => {
  const { client } = await ctx.connectClient();
  const noop = () => {};
  expect(client.on('a', noop)).toBe(client);
  expect(client.once('b', noop)).toBe(client);
  expect(client.off('a', noop)).toBe(client);
  expect(client.removeAllListeners('b')).toBe(client);
  expect(client.onAny(noop)).toBe(client);
  expect(client.offAny(noop)).toBe(client);
  expect(client.onAnyOutgoing(noop)).toBe(client);
  expect(client.offAnyOutgoing(noop)).toBe(client);
});

it('the server socket listener methods return the socket, so they chain', async () => {
  const { serverSocket } = await ctx.connectClient();
  const noop = () => {};
  expect(serverSocket.on('a', noop)).toBe(serverSocket);
  expect(serverSocket.once('b', noop)).toBe(serverSocket);
  expect(serverSocket.off('a', noop)).toBe(serverSocket);
  expect(serverSocket.removeAllListeners('b')).toBe(serverSocket);
  expect(serverSocket.onAny(noop)).toBe(serverSocket);
  expect(serverSocket.offAny(noop)).toBe(serverSocket);
  expect(serverSocket.onAnyOutgoing(noop)).toBe(serverSocket);
  expect(serverSocket.offAnyOutgoing(noop)).toBe(serverSocket);
});

it('chained registrations both take effect', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: string[] = [];
  serverSocket.on('one', () => seen.push('one')).on('two', () => seen.push('two'));

  const both = new Promise<void>((resolve) => {
    serverSocket.on('two', () => resolve());
  });
  client.emit('one');
  client.emit('two');
  await both;

  expect(seen).toEqual(['one', 'two']);
});

it('a namespace on returns the namespace, so it chains', async () => {
  const nsp = ctx.io.of('/chained');
  expect(nsp.on('connection', () => {})).toBe(nsp);
});
