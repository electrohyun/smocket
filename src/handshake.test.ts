import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

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
