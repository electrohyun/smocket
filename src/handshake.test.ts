import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { observeDisconnect } from './test-events';

const ctx = setupServer();

it('the connection handshake carries the fields a mock can source', async () => {
  const { serverSocket } = await ctx.connectClient();
  const { handshake } = serverSocket;

  // `url`, `time`, and `issued` have a source in the connection itself (0006). Their
  // exact values differ between the targets, real socket.io's `url` is the request
  // path while smocket's is the normalized origin, so the dual-run assertion pins the
  // shape; the exact origin value is checked mock-only in connect-url.test.ts.
  expect(typeof handshake.url).toBe('string');
  expect(handshake.url.length).toBeGreaterThan(0);
  expect(typeof handshake.time).toBe('string');
  expect(typeof handshake.issued).toBe('number');
});

it('handshake.auth defaults to an empty object when the client passes none', async () => {
  const { serverSocket } = await ctx.connectClient();
  expect(serverSocket.handshake.auth).toEqual({});
});

it('handshake.auth carries the client-supplied auth object through unchanged', async () => {
  // auth travels as a packet payload, not on the url, so it reaches the server as the
  // object the caller passed, with no stringifying.
  const { serverSocket } = await ctx.connectClient({ auth: { token: 'abc' } });
  expect(serverSocket.handshake.auth).toEqual({ token: 'abc' });
});

it('handshake.query stringifies the client-supplied query values', async () => {
  // A querystring decodes every value as a string, so `{ room: 1 }` arrives as
  // `{ room: '1' }`. The real target's `handshake.query` also carries engine.io's own
  // keys (EIO/transport), so only the caller's key is asserted, never a deep-equal.
  const { serverSocket } = await ctx.connectClient({ query: { room: 1 } });
  expect(serverSocket.handshake.query.room).toBe('1');
});

it('a reconnect replays the client-supplied auth on the fresh socket', async () => {
  // Real socket.io re-sends the connection's auth when it reattaches (measured against
  // the real client), so the reconnected socket carries the same auth, on a new id.
  const { client, serverSocket } = await ctx.connectClient({ auth: { token: 'abc' } });

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  const reconnected = ctx.nextConnection();
  client.connect();
  const serverSocketAgain = await reconnected;

  expect(serverSocketAgain.id).not.toBe(serverSocket.id);
  expect(serverSocketAgain.handshake.auth).toEqual({ token: 'abc' });
});
