import { expect, it } from 'vitest';
import type { MiddlewareError, ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import {
  count,
  expectNoResidualMembership,
  observeDisconnect,
  receive,
  track,
} from './test-events';

const ctx = setupServer();

it('invokes namespace middleware after the client factory returns', async () => {
  const order: string[] = [];
  ctx.io.use((_socket, next) => {
    order.push('middleware');
    next();
  });

  const client = ctx.openClient();
  order.push('connect returned');
  await receive(client, 'connect');

  expect(order).toEqual(['connect returned', 'middleware']);
});

it('does not invoke namespace middleware for a connection cancelled after return', async () => {
  let runs = 0;
  ctx.io.use((_socket, next) => {
    runs += 1;
    next();
  });

  const cancelled = ctx.openClient({ forceNew: true });
  const connects = track(cancelled, 'connect');
  const connectErrors = track(cancelled, 'connect_error');
  const disconnects = track(cancelled, 'disconnect');
  cancelled.disconnect();

  await ctx.connectClient({ forceNew: true });

  expect(runs).toBe(1);
  expect(connects.received).toBe(false);
  expect(connectErrors.received).toBe(false);
  expect(disconnects.received).toBe(false);
});

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

it('a rejected connection cleans temporary membership and stays out of the roster', async () => {
  // Admit only a connection carrying a token, so the rejected client and a later
  // accepted one differ by auth alone.
  let rejectedId: string | undefined;
  ctx.io.use(async (socket, next) => {
    if (!socket.handshake.auth.token) {
      rejectedId = socket.id;
      await socket.join('temporary-rejection');
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
  const adapter = ctx.io.of('/').adapter;
  const sids = (adapter as typeof adapter & { sids: Map<string, Set<string>> }).sids;
  expect(adapter.rooms.has(serverSocket.id)).toBe(true);
  expect(adapter.rooms.has('temporary-rejection')).toBe(false);
  expect(adapter.rooms.has(rejectedId as string)).toBe(false);
  expect(sids.has(rejectedId as string)).toBe(false);
  expect(adapter.rooms.size).toBe(1);
});

it('a cancelled connection attempt cannot be admitted by a late middleware callback', async () => {
  type Attempt = { socket: ServerSocketContract; next: (err?: MiddlewareError) => void };
  const attempts: Attempt[] = [];
  const waiters: Array<(attempt: Attempt) => void> = [];
  const offerAttempt = (attempt: Attempt): void => {
    const waiter = waiters.shift();
    if (waiter) waiter(attempt);
    else attempts.push(attempt);
  };
  const nextAttempt = (): Promise<Attempt> => {
    const attempt = attempts.shift();
    if (attempt) return Promise.resolve(attempt);
    return new Promise((resolve) => waiters.push(resolve));
  };

  ctx.io.use((socket, next) => offerAttempt({ socket, next }));
  let connections = 0;
  ctx.io.on('connection', () => {
    connections += 1;
  });

  const client = ctx.openClient();
  const connectErrors = track(client, 'connect_error');
  const disconnects = track(client, 'disconnect');
  const first = await nextAttempt();
  await first.socket.join('temporary-cancellation');

  client.disconnect();
  client.connect();
  // Reaching the middleware for a fresh attempt proves that the cancellation has
  // propagated. Releasing the old callback only after this marker avoids a timeout
  // while pinning the late-callback race itself.
  const second = await nextAttempt();
  const connected = receive(client, 'connect');
  const freshConnection = ctx.nextConnection();

  first.next();
  second.next();
  const [serverSocket] = await Promise.all([freshConnection, connected]);

  const adapter = ctx.io.of('/').adapter;
  const sids = (adapter as typeof adapter & { sids: Map<string, Set<string>> }).sids;
  expect(connections).toBe(1);
  expect(serverSocket.id).toBe(second.socket.id);
  expect(client.id).toBe(second.socket.id);
  expect(sids.has(first.socket.id)).toBe(false);
  expect(adapter.rooms.has('temporary-cancellation')).toBe(false);
  expect(connectErrors.received).toBe(false);
  expect(disconnects.received).toBe(false);
});

it('ignores duplicate connect calls while static namespace middleware is pending', async () => {
  let runs = 0;
  let release!: () => void;
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  ctx.io.use((_socket, next) => {
    runs += 1;
    release = next;
    markEntered();
  });

  const client = ctx.openClient();
  const connected = receive(client, 'connect');
  await entered;
  expect(client.connect()).toBe(client);
  release();
  await connected;

  expect(runs).toBe(1);
  expect(client.connected).toBe(true);
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

it('completes once per synchronous next call with one server Socket', async () => {
  ctx.io.use((socket, next) => {
    if (socket.handshake.auth.repeated) {
      next();
      next();
      next();
      return;
    }
    next();
  });
  const serverSockets: ServerSocketContract[] = [];
  ctx.io.on('connection', (socket) => {
    serverSockets.push(socket);
    if (serverSockets.length === 3) socket.emit('completion-marker');
  });

  const client = ctx.openClient({ auth: { repeated: true }, forceNew: true });
  const connects = count(client, 'connect');
  await receive(client, 'completion-marker');

  const firstSocket = serverSockets[0];
  expect(firstSocket).toBeDefined();
  if (!firstSocket) throw new Error('repeated middleware never admitted a server Socket');
  expect(connects.count).toBe(3);
  expect(serverSockets).toHaveLength(3);
  expect(serverSockets.every((socket) => socket === firstSocket)).toBe(true);
  expect(serverSockets.every((socket) => socket.id === firstSocket.id)).toBe(true);
  expect(firstSocket.rooms).toEqual(new Set([firstSocket.id]));
  await expect(ctx.io.of('/').fetchSockets()).resolves.toHaveLength(1);
  expect(client.id).toBe(firstSocket.id);
});

it('completes again when a retained next runs after the first connection', async () => {
  let completeAgain!: () => void;
  ctx.io.use((_socket, next) => {
    completeAgain = next;
    next();
  });
  const serverSockets: ServerSocketContract[] = [];
  ctx.io.on('connection', (socket) => {
    serverSockets.push(socket);
    if (serverSockets.length === 2) socket.emit('completion-marker');
  });

  const client = ctx.openClient({ forceNew: true });
  const connects = count(client, 'connect');
  await receive(client, 'connect');
  const marker = receive(client, 'completion-marker');
  completeAgain();
  await marker;

  expect(connects.count).toBe(2);
  expect(serverSockets).toHaveLength(2);
  expect(serverSockets[1]).toBe(serverSockets[0]);
  await expect(ctx.io.of('/').fetchSockets()).resolves.toHaveLength(1);
});

it('ignores a retained next released while the server closes', async () => {
  let completeAgain!: () => void;
  ctx.io.use((_socket, next) => {
    completeAgain = next;
    next();
  });
  let serverConnections = 0;
  ctx.io.on('connection', () => {
    serverConnections += 1;
  });

  const client = ctx.openClient({ forceNew: true });
  const connects = count(client, 'connect');
  await receive(client, 'connect');
  const disconnected = receive(client, 'disconnect');

  const closing = ctx.io.close();
  completeAgain();
  await Promise.all([closing, disconnected]);

  expect(serverConnections).toBe(1);
  expect(connects.count).toBe(1);
  expect(client.connected).toBe(false);
});

it('ignores a retained middleware error after the client disconnects', async () => {
  let rejectLater!: () => void;
  ctx.io.use((socket, next) => {
    if (socket.handshake.auth.lateRelease) {
      rejectLater = () => next(new Error('too late'));
    }
    next();
  });
  const admitted = ctx.nextConnection();

  const client = ctx.openClient({ auth: { lateRelease: true }, forceNew: true });
  const connectErrors = count(client, 'connect_error');
  const serverSocket = await admitted;
  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  const marker = await ctx.connectClient({ auth: { marker: true }, forceNew: true });
  const settled = receive(marker.client, 'settled');
  rejectLater();
  marker.serverSocket.emit('settled');
  await settled;

  expect(connectErrors.count).toBe(0);
  expect(client.connected).toBe(false);
  await expect(ctx.io.of('/').fetchSockets()).resolves.toEqual([marker.serverSocket]);
});

it('reports a later middleware error after connection and removes the server Socket', async () => {
  ctx.io.use((socket, next) => {
    next();
    if (socket.handshake.auth.lateDenial) next(new Error('late denial'));
  });
  let deniedSocket: ServerSocketContract | undefined;
  const serverLifecycle: string[] = [];
  let disconnectingRooms = new Set<string>();
  let disconnectedRooms = new Set<string>();
  let markServerDisconnected!: () => void;
  const serverDisconnected = new Promise<void>((resolve) => {
    markServerDisconnected = resolve;
  });
  ctx.io.on('connection', (socket) => {
    if (socket.handshake.auth.lateDenial) {
      deniedSocket = socket;
      socket.once('disconnecting', (reason: string) => {
        disconnectingRooms = new Set(socket.rooms);
        serverLifecycle.push(`disconnecting:${reason}`);
      });
      socket.once('disconnect', (reason: string) => {
        disconnectedRooms = new Set(socket.rooms);
        serverLifecycle.push(`disconnect:${reason}`);
        markServerDisconnected();
      });
    }
  });

  const client = ctx.openClient({ auth: { lateDenial: true }, forceNew: true });
  const clientLifecycle: string[] = [];
  let connectedId: string | undefined;
  client.on('connect', () => {
    clientLifecycle.push('connect');
    connectedId = client.id;
  });
  client.on('connect_error', () => clientLifecycle.push('connect_error'));
  const connects = count(client, 'connect');
  const connectErrors = count(client, 'connect_error');
  const connected = receive(client, 'connect');
  const denied = receive(client, 'connect_error');
  const [error] = await Promise.all([denied, connected]);
  await serverDisconnected;
  expect(disconnectingRooms).toEqual(new Set());
  expect(disconnectedRooms).toEqual(new Set());
  expectNoResidualMembership(ctx.io.of('/'));

  const marker = await ctx.connectClient({ auth: { marker: true }, forceNew: true });
  const settled = receive(marker.client, 'settled');
  marker.serverSocket.emit('settled');
  await settled;

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe('late denial');
  expect(clientLifecycle).toEqual(['connect', 'connect_error']);
  expect(connects.count).toBe(1);
  expect(connectErrors.count).toBe(1);
  expect(client.connected).toBe(true);
  expect(connectedId).toBeDefined();
  expect(client.id).toBe(connectedId);
  expect(deniedSocket?.connected).toBe(false);
  expect(deniedSocket?.rooms).toEqual(new Set());
  expect(serverLifecycle).toEqual(['disconnecting:transport close', 'disconnect:transport close']);
  await expect(ctx.io.of('/').fetchSockets()).resolves.toEqual([marker.serverSocket]);
});
