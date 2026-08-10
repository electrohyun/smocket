import { expect, it } from 'vitest';
import type { MiddlewareError, ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { receive } from './test-events';

const ctx = setupServer();

it('a pass-through middleware admits the connection and fires connection', async () => {
  ctx.io.use((_socket, next) => next());

  const connected = new Promise<ServerSocketContract>((resolve) => {
    ctx.io.on('connection', (socket: ServerSocketContract) => resolve(socket));
  });
  const { client } = await ctx.connectClient();

  const serverSocket = await connected;
  expect(client.connected).toBe(true);
  expect(serverSocket.id).toBe(client.id);
});

it('the middleware reads the connecting socket handshake', async () => {
  // The handshake is populated by the time middleware runs (0006), so an auth check
  // like this one is exactly the intended use.
  let seenToken: unknown;
  ctx.io.use((socket, next) => {
    seenToken = socket.handshake.auth.token;
    next();
  });

  await ctx.connectClient({ auth: { token: 'abc' } });
  expect(seenToken).toBe('abc');
});

it('next(err) makes the client observe connect_error with the error message', async () => {
  ctx.io.use((_socket, next) => next(new Error('unauthorized')));

  const client = ctx.openClient();
  const error = (await receive(client, 'connect_error')) as Error;

  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('unauthorized');
  expect(client.connected).toBe(false);
});

it("the rejecting error's data passes through to the client", async () => {
  ctx.io.use((_socket, next) => {
    const error: MiddlewareError = new Error('unauthorized');
    error.data = { code: 401 };
    next(error);
  });

  const client = ctx.openClient();
  const error = (await receive(client, 'connect_error')) as MiddlewareError;

  expect(error.message).toBe('unauthorized');
  expect(error.data).toEqual({ code: 401 });
});

it('a rejected connection never fires connection and is absent from the roster', async () => {
  // Admit only a connection carrying a token, so the rejected client and a later
  // accepted one differ by auth alone.
  ctx.io.use((socket, next) => {
    if (!socket.handshake.auth.token) {
      next(new Error('unauthorized'));
      return;
    }
    next();
  });

  let connections = 0;
  ctx.io.on('connection', () => {
    connections += 1;
  });

  // Drive the rejected connection to completion first: once its connect_error lands,
  // any connection it was going to fire would already have fired.
  const rejected = ctx.openClient();
  await receive(rejected, 'connect_error');

  // A second, accepted connection is the marker: after it connects, the roster and the
  // connection count reflect the accepted socket only, never the rejected one.
  const { serverSocket } = await ctx.connectClient({ auth: { token: 'ok' } });

  expect(connections).toBe(1);
  const rooms = ctx.io.of('/').adapter.rooms;
  expect(rooms.has(serverSocket.id)).toBe(true);
  expect(rooms.size).toBe(1);
});

it('io.of(nsp).use() runs only for connections on that namespace', async () => {
  let runs = 0;
  ctx.io.of('/admin').use((_socket, next) => {
    runs += 1;
    next();
  });

  // Connect on the default namespace first, and fully await it. Had that
  // connection passed through the /admin middleware, `runs` would already be
  // non-zero here, so the completed connection proves the isolation by
  // ordering rather than by waiting out a timeout.
  await ctx.connectClient();
  expect(runs).toBe(0);

  await ctx.connectClient({ namespace: '/admin' });
  expect(runs).toBe(1);
});

it('two middlewares run in registration order', async () => {
  const order: string[] = [];
  ctx.io.use((_socket, next) => {
    order.push('first');
    next();
  });
  ctx.io.use((_socket, next) => {
    order.push('second');
    next();
  });

  await ctx.connectClient();
  expect(order).toEqual(['first', 'second']);
});

it('an error in the first middleware short-circuits the second', async () => {
  const ran: string[] = [];
  ctx.io.use((_socket, next) => {
    ran.push('first');
    next(new Error('nope'));
  });
  ctx.io.use((_socket, next) => {
    ran.push('second');
    next();
  });

  const client = ctx.openClient();
  const error = (await receive(client, 'connect_error')) as Error;

  expect(error.message).toBe('nope');
  expect(ran).toEqual(['first']);
});
