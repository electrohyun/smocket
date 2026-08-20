import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { expectNoResidualMembership, observeDisconnect, receive, track } from './test-events';

const ctx = setupServer();

it('emits new_namespace synchronously once for static namespaces but not root or parents', () => {
  const seen: string[] = [];
  ctx.io.on('new_namespace', (namespace) => seen.push(namespace.name));

  const root = ctx.io.of('/');
  expect(seen).toEqual([]);

  const game = ctx.io.of('/game');
  expect(seen).toEqual(['/game']);
  expect(ctx.io.of('game')).toBe(game);
  expect(seen).toEqual(['/game']);

  ctx.io.of(/^\/tenant-\d+$/);
  expect(ctx.io.of('/')).toBe(root);
  expect(seen).toEqual(['/game']);
});

it('admits RegExp children, caches them, and attaches manual children to the parent', async () => {
  const parent = ctx.io.of(/^\/tenant-\d+$/);
  const connected: string[] = [];
  parent.on('connection', (socket) => connected.push(socket.nsp.name));

  const first = ctx.openClient({ namespace: '/tenant-1' });
  await receive(first, 'connect');
  const child = ctx.io.of('/tenant-1');

  const second = ctx.openClient({ namespace: '/tenant-1' });
  await receive(second, 'connect');
  expect(ctx.io.of('/tenant-1')).toBe(child);

  const manual = ctx.io.of('/tenant-2');
  const third = ctx.openClient({ namespace: '/tenant-2' });
  await receive(third, 'connect');

  expect(connected).toEqual(['/tenant-1', '/tenant-1', '/tenant-2']);
  expect(ctx.io.of('/tenant-2')).toBe(manual);
});

it('preserves stateful RegExp lastIndex across dynamic admission attempts', async () => {
  const matcher = /^\/state-[ab]$/g;
  ctx.io.of(matcher);

  const first = ctx.openClient({ namespace: '/state-a' });
  await receive(first, 'connect');
  expect(matcher.lastIndex).toBe('/state-a'.length);

  const second = ctx.openClient({ namespace: '/state-b' });
  const outcome = await Promise.race([
    receive(second, 'connect').then(() => 'connect' as const),
    receive(second, 'connect_error'),
  ]);

  expect(outcome).not.toBe('connect');
  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toBe('Invalid namespace');
  expect(matcher.lastIndex).toBe(0);
});

it('does not re-evaluate a stateful RegExp parent when reading cached namespaces', async () => {
  const matcher = /^\/cached-state$/g;
  ctx.io.of(matcher);

  const client = ctx.openClient({ namespace: '/cached-state' });
  await receive(client, 'connect');
  expect(matcher.lastIndex).toBe('/cached-state'.length);

  expect(ctx.io.of('/cached-state').name).toBe('/cached-state');
  expect(matcher.lastIndex).toBe('/cached-state'.length);
  ctx.io.emit('root-read');
  expect(matcher.lastIndex).toBe('/cached-state'.length);
});

it('preserves sticky RegExp lastIndex across dynamic admission attempts', async () => {
  const matcher = /^\/sticky-[ab]$/y;
  ctx.io.of(matcher);

  const first = ctx.openClient({ namespace: '/sticky-a' });
  await receive(first, 'connect');
  expect(matcher.lastIndex).toBe('/sticky-a'.length);

  const second = ctx.openClient({ namespace: '/sticky-b' });
  const outcome = await Promise.race([
    receive(second, 'connect').then(() => 'connect' as const),
    receive(second, 'connect_error'),
  ]);

  expect(outcome).not.toBe('connect');
  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toBe('Invalid namespace');
  expect(matcher.lastIndex).toBe(0);
});

it('resets caller-assigned RegExp lastIndex after a failed manual attachment match', async () => {
  const matcher = /^\/manual-state$/g;
  const parent = ctx.io.of(matcher);
  const inherited: string[] = [];
  parent.on('connection', (socket) => inherited.push(socket.nsp.name));
  matcher.lastIndex = 1;

  ctx.io.of('/manual-state');
  const client = ctx.openClient({ namespace: '/manual-state' });
  await receive(client, 'connect');

  expect(inherited).toEqual([]);
  expect(matcher.lastIndex).toBe(0);
});

it('uses admission order but the latest duplicate RegExp parent for manual attachment', async () => {
  const matcher = /^\/duplicate-(dynamic|manual)$/;
  const inherited: string[] = [];
  ctx.io.of(matcher).on('connection', (socket) => inherited.push(`first:${socket.nsp.name}`));
  ctx.io.of(matcher).on('connection', (socket) => inherited.push(`latest:${socket.nsp.name}`));

  const dynamicClient = ctx.openClient({ namespace: '/duplicate-dynamic' });
  await receive(dynamicClient, 'connect');

  ctx.io.of('/duplicate-manual');
  const manualClient = ctx.openClient({ namespace: '/duplicate-manual' });
  await receive(manualClient, 'connect');

  expect(inherited).toEqual(['first:/duplicate-dynamic', 'latest:/duplicate-manual']);
});

it('does not attach a manually created namespace to a function parent', async () => {
  const inherited: string[] = [];
  ctx.io
    .of((_name, _auth, next) => next(null, true))
    .on('connection', (socket) => inherited.push(socket.nsp.name));

  ctx.io.of('/manual-function-parent');
  const client = ctx.openClient({ namespace: '/manual-function-parent' });
  await receive(client, 'connect');

  expect(inherited).toEqual([]);
});

it('reuses one child for concurrent admission and supports the of listener overload', async () => {
  const seenNamespaces: string[] = [];
  const connected: string[] = [];
  ctx.io.on('new_namespace', (namespace) => seenNamespaces.push(namespace.name));
  ctx.io.of(/^\/race-/, (socket) => connected.push(socket.nsp.name));

  const first = ctx.openClient({ namespace: '/race-a' });
  const second = ctx.openClient({ namespace: '/race-a' });
  await Promise.all([receive(first, 'connect'), receive(second, 'connect')]);

  expect(seenNamespaces).toEqual(['/race-a']);
  expect(connected).toEqual(['/race-a', '/race-a']);
  expect(ctx.io.of('/race-a').name).toBe('/race-a');
});

it('tries function matchers in order with normalized names and auth until one allows', async () => {
  const calls: Array<[string, string, unknown]> = [];
  ctx.io.of((name, auth, next) => {
    calls.push(['error', name, auth.tenant]);
    next(new Error('keep looking'), false);
  });
  ctx.io.of((name, auth, next) => {
    calls.push(['reject', name, auth.tenant]);
    next(null, false);
  });
  const accepted = ctx.io.of((name, auth, next) => {
    calls.push(['allow', name, auth.tenant]);
    queueMicrotask(() => next(null, true));
  });
  ctx.io.of((_name, _auth, next) => {
    calls.push(['too-late', '', undefined]);
    next(null, true);
  });

  const serverConnection = new Promise<string>((resolve) =>
    accepted.on('connection', (socket) => resolve(socket.nsp.name)),
  );
  const client = ctx.openClient({ namespace: 'team', auth: { tenant: 'blue' } });
  await receive(client, 'connect');

  await expect(serverConnection).resolves.toBe('/team');
  expect(calls).toEqual([
    ['error', '/team', 'blue'],
    ['reject', '/team', 'blue'],
    ['allow', '/team', 'blue'],
  ]);
});

it('invokes a dynamic namespace matcher after the client factory returns', async () => {
  const order: string[] = [];
  ctx.io.of((_name, _auth, next) => {
    order.push('matcher');
    next(null, true);
  });

  const client = ctx.openClient({ namespace: '/return-boundary' });
  order.push('connect returned');
  await receive(client, 'connect');

  expect(order).toEqual(['connect returned', 'matcher']);
});

it('does not invoke a dynamic matcher for a connection cancelled after return', async () => {
  let matcherRuns = 0;
  ctx.io.of((_name, _auth, next) => {
    matcherRuns += 1;
    next(null, true);
  });

  const cancelled = ctx.openClient({ namespace: '/cancelled-return', forceNew: true });
  const connects = track(cancelled, 'connect');
  const connectErrors = track(cancelled, 'connect_error');
  const disconnects = track(cancelled, 'disconnect');
  cancelled.disconnect();

  const marker = ctx.openClient({ namespace: '/marker-return', forceNew: true });
  await receive(marker, 'connect');

  expect(matcherRuns).toBe(1);
  expect(connects.received).toBe(false);
  expect(connectErrors.received).toBe(false);
  expect(disconnects.received).toBe(false);
});

it('rejects an unmatched dynamic namespace as Invalid namespace', async () => {
  ctx.io.of(/^\/tenant-\d+$/);
  ctx.io.of((_name, _auth, next) => next(null, false));

  const client = ctx.openClient({ namespace: '/outside' });
  const outcome = await receive(client, 'connect_error');

  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).message).toBe('Invalid namespace');
  expect(client.connected).toBe(false);
  expect(client.id).toBeUndefined();
});

it('retries dynamic admission after an earlier matcher rejection', async () => {
  ctx.io.of((_name, _auth, next) => next(null, false));
  const client = ctx.openClient({ namespace: '/dynamic-retry' });
  await receive(client, 'connect_error');

  const accepted = ctx.io.of(/^\/dynamic-retry$/);
  const serverConnection = new Promise<string>((resolve) => {
    accepted.on('connection', (socket) => resolve(socket.nsp.name));
  });
  const connected = receive(client, 'connect');
  expect(client.connect()).toBe(client);

  await expect(Promise.all([serverConnection, connected])).resolves.toEqual([
    '/dynamic-retry',
    undefined,
  ]);
});

it('dynamic admission reads the current client.auth on a manual retry', async () => {
  const seen: unknown[] = [];
  ctx.io.of((_name, auth, next) => {
    seen.push(auth.token);
    next(null, auth.token === 'accepted');
  });

  const client = ctx.openClient({ namespace: '/auth-retry', auth: { token: 'rejected' } });
  await receive(client, 'connect_error');

  client.auth = { token: 'accepted' };
  const connected = receive(client, 'connect');
  client.connect();
  await connected;

  expect(seen).toEqual(['rejected', 'accepted']);
});

it('creates a child before middleware and snapshots parent setup at creation', async () => {
  const order: string[] = [];
  ctx.io.on('new_namespace', (namespace) => order.push(`new:${namespace.name}`));
  const parent = ctx.io.of(/^\/project-/);
  parent.use((socket, next) => {
    order.push(`middleware:${socket.nsp.name}`);
    next();
  });
  parent.on('connection', (socket) => order.push(`connection:${socket.nsp.name}`));

  const first = ctx.openClient({ namespace: '/project-a' });
  await receive(first, 'connect');
  expect(order).toEqual(['new:/project-a', 'middleware:/project-a', 'connection:/project-a']);

  parent.use((socket, next) => {
    order.push(`late-middleware:${socket.nsp.name}`);
    next();
  });
  parent.on('connection', (socket) => order.push(`late-connection:${socket.nsp.name}`));

  order.length = 0;
  const existing = ctx.openClient({ namespace: '/project-a' });
  await receive(existing, 'connect');
  expect(order).toEqual(['middleware:/project-a', 'connection:/project-a']);

  order.length = 0;
  const future = ctx.openClient({ namespace: '/project-b' });
  await receive(future, 'connect');
  expect(order).toEqual([
    'new:/project-b',
    'middleware:/project-b',
    'late-middleware:/project-b',
    'connection:/project-b',
    'late-connection:/project-b',
  ]);
});

it('copies the parent connect synonym to a concrete child', async () => {
  const parent = ctx.io.of(/^\/connect-synonym$/);
  const connected: string[] = [];
  parent.on('connect', (socket) => connected.push(socket.nsp.name));

  const client = ctx.openClient({ namespace: '/connect-synonym' });
  await receive(client, 'connect');

  expect(connected).toEqual(['/connect-synonym']);
});

it('ignores duplicate client connect calls while async dynamic admission is pending', async () => {
  let matcherCalls = 0;
  let releaseMatcher!: () => void;
  let markMatcherEntered!: () => void;
  const matcherEntered = new Promise<void>((resolve) => {
    markMatcherEntered = resolve;
  });
  const parent = ctx.io.of((_name, _auth, next) => {
    matcherCalls += 1;
    releaseMatcher = () => next(null, true);
    markMatcherEntered();
  });
  const serverConnections: string[] = [];
  parent.on('connection', (socket) => serverConnections.push(socket.id));

  const client = ctx.openClient({ namespace: '/duplicate-connect' });
  const connected = receive(client, 'connect');
  await matcherEntered;
  expect(client.connect()).toBe(client);
  releaseMatcher();
  await connected;

  expect(matcherCalls).toBe(1);
  expect(serverConnections).toHaveLength(1);
});

it('cancels dynamic admission while callback-form auth is unresolved', async () => {
  const markerConnection = await ctx.connectClient({ namespace: '/auth-marker', forceNew: true });
  ctx.io.of(/^\/auth-unresolved$/);
  const created: string[] = [];
  ctx.io.on('new_namespace', (namespace) => created.push(namespace.name));
  let releaseAuth!: (auth: Record<string, unknown>) => void;
  let markAuthRequested!: () => void;
  const authRequested = new Promise<void>((resolve) => {
    markAuthRequested = resolve;
  });
  const client = ctx.openClient({
    namespace: '/auth-unresolved',
    auth: (callback) => {
      releaseAuth = callback;
      markAuthRequested();
    },
    forceNew: true,
  });
  const connects = track(client, 'connect');
  const connectErrors = track(client, 'connect_error');
  const disconnects = track(client, 'disconnect');
  await authRequested;

  client.disconnect();
  releaseAuth({ tenant: 'cancelled' });

  const marker = receive(markerConnection.client, 'marker');
  markerConnection.serverSocket.emit('marker', 'settled');
  await expect(marker).resolves.toBe('settled');

  expect(connects.received).toBe(false);
  expect(connectErrors.received).toBe(false);
  expect(disconnects.received).toBe(false);
  expect(created).not.toContain('/auth-unresolved');
  expectNoResidualMembership(ctx.io.of('/auth-unresolved'));
});

it('cancels unresolved dynamic matching with shared Manager disconnect(true)', async () => {
  const root = await ctx.connectClient();
  const markerConnection = await ctx.connectClient({
    namespace: '/manager-marker',
    forceNew: true,
  });
  const rootLifecycle = observeDisconnect(root.serverSocket);
  const rootClientDisconnected = receive(root.client, 'disconnect');
  const created: string[] = [];
  ctx.io.on('new_namespace', (namespace) => created.push(namespace.name));
  let releaseMatcher!: () => void;
  let markMatcherEntered!: () => void;
  const matcherEntered = new Promise<void>((resolve) => {
    markMatcherEntered = resolve;
  });
  ctx.io.of((_name, _auth, next) => {
    releaseMatcher = () => next(null, true);
    markMatcherEntered();
  });

  const pending = ctx.openClient({ namespace: '/manager-unresolved' });
  const connects = track(pending, 'connect');
  const connectErrors = track(pending, 'connect_error');
  await matcherEntered;
  expect(pending.io).toBe(root.client.io);

  root.serverSocket.disconnect(true);
  await Promise.all([
    rootLifecycle.disconnecting,
    rootLifecycle.disconnected,
    rootClientDisconnected,
  ]);
  releaseMatcher();

  const marker = receive(markerConnection.client, 'marker');
  markerConnection.serverSocket.emit('marker', 'settled');
  await expect(marker).resolves.toBe('settled');

  expect(connects.received).toBe(false);
  expect(connectErrors.received).toBe(false);
  expect(created).toEqual(['/manager-unresolved']);
  expectNoResidualMembership(ctx.io.of('/manager-unresolved'));
});

it('continues parent matching after a cancelled parent rejects late', async () => {
  const root = await ctx.connectClient();
  const markerConnection = await ctx.connectClient({
    namespace: '/rejection-marker',
    forceNew: true,
  });
  const rootLifecycle = observeDisconnect(root.serverSocket);
  const rootClientDisconnected = receive(root.client, 'disconnect');
  let releaseFirst!: () => void;
  let markFirstEntered!: () => void;
  const firstEntered = new Promise<void>((resolve) => {
    markFirstEntered = resolve;
  });
  ctx.io.of((_name, _auth, next) => {
    releaseFirst = () => next(null, false);
    markFirstEntered();
  });
  let secondCalls = 0;
  let admissions = 0;
  const second = ctx.io.of((_name, _auth, next) => {
    secondCalls += 1;
    next(null, true);
  });
  second.on('connection', () => {
    admissions += 1;
  });
  const created: string[] = [];
  ctx.io.on('new_namespace', (namespace) => created.push(namespace.name));

  const pending = ctx.openClient({ namespace: '/late-rejection' });
  const connects = track(pending, 'connect');
  const connectErrors = track(pending, 'connect_error');
  await firstEntered;
  expect(pending.io).toBe(root.client.io);

  root.serverSocket.disconnect(true);
  await Promise.all([
    rootLifecycle.disconnecting,
    rootLifecycle.disconnected,
    rootClientDisconnected,
  ]);
  releaseFirst();

  const marker = receive(markerConnection.client, 'marker');
  markerConnection.serverSocket.emit('marker', 'settled');
  await expect(marker).resolves.toBe('settled');

  expect(secondCalls).toBe(1);
  expect(created).toEqual(['/late-rejection']);
  expect(connects.received).toBe(false);
  expect(connectErrors.received).toBe(false);
  expect(admissions).toBe(0);
  expectNoResidualMembership(ctx.io.of('/late-rejection'));
});

it('reuses one child for concurrent async same-name admissions', async () => {
  const callbacks: Array<() => void> = [];
  let markBothMatchersEntered!: () => void;
  const bothMatchersEntered = new Promise<void>((resolve) => {
    markBothMatchersEntered = resolve;
  });
  const parent = ctx.io.of((_name, _auth, next) => {
    callbacks.push(() => next(null, true));
    if (callbacks.length === 2) markBothMatchersEntered();
  });
  const children: unknown[] = [];
  parent.on('connection', (socket) => children.push(socket.nsp));
  const created: string[] = [];
  ctx.io.on('new_namespace', (namespace) => created.push(namespace.name));

  const first = ctx.openClient({ namespace: '/async-race' });
  const second = ctx.openClient({ namespace: '/async-race' });
  const firstConnected = receive(first, 'connect');
  const secondConnected = receive(second, 'connect');
  await bothMatchersEntered;
  for (const callback of callbacks) callback();
  await Promise.all([firstConnected, secondConnected]);

  expect(created).toEqual(['/async-race']);
  expect(children).toHaveLength(2);
  expect(children[0]).toBe(children[1]);
  expect(children[0]).toBe(ctx.io.of('/async-race'));
});

it('broadcasts directly across children while child rooms and lifecycle stay isolated', async () => {
  const parent = ctx.io.of(/^\/group-/);
  const sockets = new Map<string, Awaited<ReturnType<typeof ctx.nextConnection>>>();
  parent.on('connection', (socket) => sockets.set(socket.nsp.name, socket));
  const a = ctx.openClient({ namespace: '/group-a' });
  const b = ctx.openClient({ namespace: '/group-b' });
  await Promise.all([receive(a, 'connect'), receive(b, 'connect')]);
  const aSocket = sockets.get('/group-a');
  const bSocket = sockets.get('/group-b');
  expect(aSocket).toBeDefined();
  expect(bSocket).toBeDefined();
  if (!aSocket || !bSocket) throw new Error('dynamic child sockets were not observed');
  await aSocket.join('shared');
  await bSocket.join('shared');

  const allA = receive(a, 'all');
  const allB = receive(b, 'all');
  parent.emit('all', 'hello');
  await expect(Promise.all([allA, allB])).resolves.toEqual(['hello', 'hello']);

  const bMissed = track(b, 'only-a');
  const bMarker = receive(b, 'marker');
  const aMessage = receive(a, 'only-a');
  ctx.io.of('/group-a').to('shared').emit('only-a', 'yes');
  ctx.io.of('/group-b').emit('marker');
  await expect(aMessage).resolves.toBe('yes');
  await bMarker;
  expect(bMissed.received).toBe(false);

  const aDisconnected = receive(a, 'disconnect');
  aSocket.disconnect();
  await aDisconnected;
  expect(b.connected).toBe(true);
});

it('exposes narrowed parent operators without selecting their delivery result', () => {
  const parent = ctx.io.of(/^\/operators-/);

  expect(parent.to('room')).toBeDefined();
  expect(parent.in('room')).toBeDefined();
  expect(parent.except('room')).toBeDefined();
  expect(parent.timeout(100)).toBeDefined();
  expect(parent.volatile).toBeDefined();
  expect(parent.to('room').in('second-room').except('muted').timeout(100).volatile).toBeDefined();
});

it('keeps shared Manager teardown connection-wide across dynamic children', async () => {
  const parent = ctx.io.of(/^\/manager-/);
  const sockets = new Map<string, Awaited<ReturnType<typeof ctx.nextConnection>>>();
  parent.on('connection', (socket) => sockets.set(socket.nsp.name, socket));
  const a = ctx.openClient({ namespace: '/manager-a' });
  await receive(a, 'connect');
  const b = ctx.openClient({ namespace: '/manager-b' });
  await receive(b, 'connect');

  const aDisconnected = receive(a, 'disconnect');
  const bDisconnected = receive(b, 'disconnect');
  const aSocket = sockets.get('/manager-a');
  expect(aSocket).toBeDefined();
  if (!aSocket) throw new Error('dynamic child socket was not observed');
  aSocket.disconnect(true);
  await Promise.all([aDisconnected, bDisconnected]);

  expect(a.connected).toBe(false);
  expect(b.connected).toBe(false);
});

it('uses one concrete child for nextConnection, lookup, and Manager grouping', async () => {
  ctx.io.of((_name, _auth, next) => next(null, true));
  const firstConnection = ctx.nextConnection('/space-a');
  const first = ctx.openClient({ namespace: '/space-a' });
  const firstConnected = receive(first, 'connect');
  const [firstSocket] = await Promise.all([firstConnection, firstConnected]);

  const secondConnection = ctx.nextConnection('/space-b');
  const second = ctx.openClient({ namespace: '/space-b' });
  const secondConnected = receive(second, 'connect');
  const [secondSocket] = await Promise.all([secondConnection, secondConnected]);

  expect(firstSocket.nsp).toBe(ctx.io.of('/space-a'));
  expect(secondSocket.nsp).toBe(ctx.io.of('/space-b'));
  expect(first.io).toBe(second.io);
});

it('creates a RegExp child when nextConnection observes it before a client connects', async () => {
  const created: string[] = [];
  const inherited: string[] = [];
  ctx.io.on('new_namespace', (namespace) => created.push(namespace.name));
  ctx.io.of(/^\/space-c$/).on('connection', (socket) => inherited.push(socket.nsp.name));

  const serverConnection = ctx.nextConnection('/space-c');
  expect(created).toEqual(['/space-c']);

  const client = ctx.openClient({ namespace: '/space-c' });
  const connected = receive(client, 'connect');
  const [serverSocket] = await Promise.all([serverConnection, connected]);

  expect(serverSocket.nsp).toBe(ctx.io.of('/space-c'));
  expect(inherited).toEqual(['/space-c']);
});

it('keeps new_namespace available as an ordinary Socket payload event', async () => {
  const { client, serverSocket } = await ctx.connectClient();

  const fromServer = receive(client, 'new_namespace');
  serverSocket.emit('new_namespace', 'server payload');
  await expect(fromServer).resolves.toBe('server payload');

  const fromClient = new Promise<string>((resolve) => serverSocket.once('new_namespace', resolve));
  client.emit('new_namespace', 'client payload');
  await expect(fromClient).resolves.toBe('client payload');
});
