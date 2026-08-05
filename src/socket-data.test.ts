import { expect, it } from 'vitest';
import type { ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { observeDisconnect } from './test-events';

// `socket.data` is the per-socket store connection middleware writes and a handler reads
// (#108). Measured against real socket.io 4.8.3: it is an empty object at creation, present
// before middleware runs, and tied to the socket, so a reconnection (a fresh socket) starts
// empty rather than carrying the previous value over. Server-side only, never sent to the client.
const ctx = setupServer();

it('socket.data is an empty object at connection', async () => {
  const { serverSocket } = await ctx.connectClient();
  expect(serverSocket.data).toEqual({});
});

it('middleware writes to data and a connection handler reads it back', async () => {
  let dataAtEntry: unknown;
  ctx.io.use((socket, next) => {
    dataAtEntry = { ...socket.data }; // snapshot before middleware writes to it
    socket.data.userId = socket.handshake.auth.token;
    next();
  });
  const seen = new Promise<unknown>((resolve) =>
    ctx.io.on('connection', (socket: ServerSocketContract) => resolve(socket.data.userId)),
  );
  const { serverSocket } = await ctx.connectClient({ auth: { token: 'abc' } });
  expect(dataAtEntry).toEqual({}); // present as an empty object before middleware runs
  expect(await seen).toBe('abc');
  expect(serverSocket.data.userId).toBe('abc');
});

it('each socket has its own data', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  a.serverSocket.data.v = 'a';
  b.serverSocket.data.v = 'b';
  expect(a.serverSocket.data.v).toBe('a');
  expect(b.serverSocket.data.v).toBe('b');
});

it('a reconnection gets a fresh, empty data rather than the previous socket store', async () => {
  ctx.io.use((socket, next) => {
    socket.data.userId = 'u1';
    next();
  });
  const { client, serverSocket } = await ctx.connectClient();
  // A handler writes something extra onto the first socket's store.
  serverSocket.data.scratch = 'set-by-handler';

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  const reconnected = ctx.nextConnection();
  client.connect();
  const again = await reconnected;

  expect(again).not.toBe(serverSocket);
  // Middleware re-ran on the fresh socket (so userId is set again), but the handler's
  // `scratch` did not carry over: data is tied to the socket, not the client.
  expect(again.data).toEqual({ userId: 'u1' });
});
