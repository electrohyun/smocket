import { expect, it, vi } from 'vitest';
import { setupServer } from './setup-server';
import { receive } from './test-events';

const ctx = setupServer();

it('Server listener methods delegate state and runtime identity to the root Namespace', async () => {
  const root = ctx.io.of('/');
  const listener = () => {};
  const receivers: unknown[] = [];

  expect(ctx.io.on('server-on', listener)).toBe(root);
  expect(ctx.io.addListener('server-add', listener)).toBe(root);
  expect(ctx.io.once('server-once', listener)).toBe(root);
  expect(ctx.io.prependListener('server-prepend', listener)).toBe(root);
  expect(ctx.io.prependOnceListener('server-prepend-once', listener)).toBe(root);
  expect(ctx.io.listeners('server-on')).toEqual(root.listeners('server-on'));
  expect(ctx.io.rawListeners('server-once')).toEqual(root.rawListeners('server-once'));
  expect(ctx.io.listenerCount('server-add')).toBe(root.listenerCount('server-add'));
  expect(ctx.io.eventNames()).toEqual(root.eventNames());
  expect(ctx.io.removeListener('server-add', listener)).toBe(root);
  expect(ctx.io.off('server-on', listener)).toBe(root);
  expect(ctx.io.removeAllListeners('server-prepend')).toBe(root);

  ctx.io.once('connection', function (this: typeof root) {
    receivers.push(this);
  });
  await ctx.connectClient();
  expect(receivers).toEqual([root]);
});

it('Namespace prepend methods order connection listeners and expose once wrappers', async () => {
  const namespace = ctx.io.of('/namespace-emitter');
  const order: string[] = [];
  const normal = () => order.push('normal');
  const prepended = () => order.push('prepended');
  const once = () => order.push('once');
  const prependedOnce = () => order.push('prepended-once');

  expect(namespace.on('connection', normal)).toBe(namespace);
  expect(namespace.prependListener('connection', prepended)).toBe(namespace);
  expect(namespace.once('connection', once)).toBe(namespace);
  expect(namespace.prependOnceListener('connection', prependedOnce)).toBe(namespace);

  expect(namespace.listeners('connection')).toEqual([prependedOnce, prepended, normal, once]);
  const raw = namespace.rawListeners('connection');
  expect(raw).not.toBe(namespace.rawListeners('connection'));
  expect(raw[0]).not.toBe(prependedOnce);
  expect((raw[0] as typeof prependedOnce & { listener?: typeof prependedOnce }).listener).toBe(
    prependedOnce,
  );
  expect((raw[3] as typeof once & { listener?: typeof once }).listener).toBe(once);

  await ctx.connectClient({ namespace: '/namespace-emitter' });
  expect(order).toEqual(['prepended-once', 'prepended', 'normal', 'once']);
  order.length = 0;

  await ctx.connectClient({ namespace: '/namespace-emitter' });
  expect(order).toEqual(['prepended', 'normal']);
});

it('ParentNamespace snapshots inherited listener ordering when each child is created', async () => {
  const parent = ctx.io.of(/^\/parent-emitter-[ab]$/);
  const order: string[] = [];
  const receivers: unknown[] = [];
  const normal = function (this: unknown): void {
    receivers.push(this);
    order.push('normal');
  };
  const prepended = () => order.push('prepended');
  const once = () => order.push('once');
  const prependedOnce = () => order.push('prepended-once');

  parent.on('connection', normal);
  parent.prependListener('connection', prepended);
  parent.once('connection', once);
  parent.prependOnceListener('connection', prependedOnce);
  expect(parent.listeners('connection')).toEqual([prependedOnce, prepended, normal, once]);

  const first = ctx.openClient({ namespace: '/parent-emitter-a' });
  await receive(first, 'connect');
  expect(order).toEqual(['prepended-once', 'prepended', 'normal', 'once']);
  order.length = 0;

  parent.removeListener('connection', normal);
  parent.on('connection', () => order.push('late'));

  const existingChild = ctx.openClient({ namespace: '/parent-emitter-a' });
  await receive(existingChild, 'connect');
  expect(order).toEqual(['prepended-once', 'prepended', 'normal', 'once']);
  order.length = 0;

  const second = ctx.openClient({ namespace: '/parent-emitter-b' });
  await receive(second, 'connect');
  expect(order).toEqual(['prepended-once', 'prepended', 'once', 'late']);
  expect(parent.listenerCount('connection')).toBe(4);
  expect(receivers).toEqual([ctx.io.of('/parent-emitter-a'), ctx.io.of('/parent-emitter-a')]);
});

it('server Socket inherited methods preserve Node ordering and raw listener identity', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  const normal = () => order.push('normal');
  const prepended = () => order.push('prepended');
  const once = () => order.push('once');
  const prependedOnce = () => order.push('prepended-once');

  expect(serverSocket.addListener('ordered', normal)).toBe(serverSocket);
  expect(serverSocket.prependListener('ordered', prepended)).toBe(serverSocket);
  expect(serverSocket.once('ordered', once)).toBe(serverSocket);
  expect(serverSocket.prependOnceListener('ordered', prependedOnce)).toBe(serverSocket);
  expect(serverSocket.listeners('ordered')).toEqual([prependedOnce, prepended, normal, once]);

  const raw = serverSocket.rawListeners('ordered');
  expect(raw).not.toBe(serverSocket.rawListeners('ordered'));
  expect((raw[0] as typeof prependedOnce & { listener?: typeof prependedOnce }).listener).toBe(
    prependedOnce,
  );
  expect((raw[3] as typeof once & { listener?: typeof once }).listener).toBe(once);

  const marked = new Promise<void>((resolve) => serverSocket.once('marker', () => resolve()));
  client.emit('ordered');
  client.emit('ordered');
  client.emit('marker');
  await marked;

  expect(order).toEqual(['prepended-once', 'prepended', 'normal', 'once', 'prepended', 'normal']);
  expect(serverSocket.rawListeners('ordered')).toEqual([prepended, normal]);
});

it('named listener callbacks receive their Namespace or Socket receiver', async () => {
  const namespace = ctx.io.of('/emitter-receiver');
  const namespaceReceivers: unknown[] = [];
  namespace.once('connection', function (this: typeof namespace) {
    namespaceReceivers.push(this);
  });
  await ctx.connectClient({ namespace: '/emitter-receiver' });
  expect(namespaceReceivers).toEqual([namespace]);

  const { client, serverSocket } = await ctx.connectClient();
  const serverReceivers: unknown[] = [];
  const clientReceivers: unknown[] = [];
  serverSocket.once('server-bound', function (this: typeof serverSocket) {
    serverReceivers.push(this);
  });
  client.once('client-bound', function (this: typeof client) {
    clientReceivers.push(this);
  });

  const serverMarked = new Promise<void>((resolve) =>
    serverSocket.once('server-marker', () => resolve()),
  );
  client.emit('server-bound');
  client.emit('server-marker');
  await serverMarked;

  const clientMarked = receive(client, 'client-marker');
  serverSocket.emit('client-bound');
  serverSocket.emit('client-marker');
  await clientMarked;

  expect(serverReceivers).toEqual([serverSocket]);
  expect(clientReceivers).toEqual([client]);

  expect(() =>
    namespace.on('invalid', undefined as unknown as Parameters<typeof namespace.on>[1]),
  ).toThrow(TypeError);
  expect(() =>
    namespace.once('invalid', undefined as unknown as Parameters<typeof namespace.once>[1]),
  ).toThrow(TypeError);
  expect(() =>
    namespace.prependOnceListener(
      'invalid',
      undefined as unknown as Parameters<typeof namespace.prependOnceListener>[1],
    ),
  ).toThrow(TypeError);
  expect(() =>
    serverSocket.on('invalid', undefined as unknown as Parameters<typeof serverSocket.on>[1]),
  ).toThrow(TypeError);
  expect(() =>
    serverSocket.once('invalid', undefined as unknown as Parameters<typeof serverSocket.once>[1]),
  ).toThrow(TypeError);
  expect(() =>
    serverSocket.prependOnceListener(
      'invalid',
      undefined as unknown as Parameters<typeof serverSocket.prependOnceListener>[1],
    ),
  ).toThrow(TypeError);
});

it('Node emitter aliases remove the last matching registration', async () => {
  const { serverSocket } = await ctx.connectClient();
  const listener = () => {};

  serverSocket.on('duplicate', listener);
  serverSocket.once('duplicate', listener);
  serverSocket.addListener('duplicate', listener);
  expect(serverSocket.listenerCount('duplicate', listener)).toBe(3);

  expect(serverSocket.removeListener('duplicate', listener)).toBe(serverSocket);
  expect(serverSocket.rawListeners('duplicate')).toHaveLength(2);
  expect(serverSocket.off).toBe(serverSocket.removeListener);
  serverSocket.off('duplicate', listener);
  expect(serverSocket.rawListeners('duplicate')).toEqual([listener]);
});

it('once wrapper identity properties remain specific to each emitter side', async () => {
  const namespace = ctx.io.of('/wrapper-property');
  const { client, serverSocket } = await ctx.connectClient();
  const other = () => {};
  const nodeDirect = Object.assign(() => {}, { fn: other });
  const clientDirect = Object.assign(() => {}, { listener: other });

  for (const emitter of [namespace, serverSocket]) {
    emitter.on('node-direct', nodeDirect);
    expect(emitter.listeners('node-direct')).toEqual([nodeDirect]);
    emitter.removeListener('node-direct', other);
    expect(emitter.listeners('node-direct')).toEqual([nodeDirect]);
  }

  client.on('client-direct', clientDirect);
  client.off('client-direct', other);
  expect(client.listeners('client-direct')).toEqual([clientDirect]);
});

it('max-listener state is receiver-local and Server delegates it to root', async () => {
  const root = ctx.io.of('/');
  const namespace = ctx.io.of('/max-listeners');
  const parent = ctx.io.of(/^\/max-listeners-/);
  const { serverSocket } = await ctx.connectClient();

  expect(root.getMaxListeners()).toBe(10);
  expect(namespace.getMaxListeners()).toBe(10);
  expect(parent.getMaxListeners()).toBe(10);
  expect(serverSocket.getMaxListeners()).toBe(10);

  expect(ctx.io.setMaxListeners(17)).toBe(root);
  expect(ctx.io.getMaxListeners()).toBe(17);
  expect(root.getMaxListeners()).toBe(17);
  expect(namespace.getMaxListeners()).toBe(10);
  expect(parent.setMaxListeners(23)).toBe(parent);
  expect(serverSocket.setMaxListeners(29)).toBe(serverSocket);
  expect(parent.getMaxListeners()).toBe(23);
  expect(serverSocket.getMaxListeners()).toBe(29);
  expect(() => namespace.setMaxListeners(-1)).toThrow(RangeError);
  expect(() => serverSocket.setMaxListeners(-1)).toThrow(RangeError);
});

it('Node receivers warn once when a listener count exceeds their local maximum', async () => {
  const namespace = ctx.io.of('/listener-warning');
  const parent = ctx.io.of(/^\/listener-warning-parent$/);
  const { serverSocket } = await ctx.connectClient();
  const processHost = (
    globalThis as typeof globalThis & {
      process?: { emitWarning: (warning: Error) => void };
    }
  ).process;
  const warnings: Array<Error & { count?: number; type?: string | symbol }> = [];
  const warningSpy = processHost
    ? vi.spyOn(processHost, 'emitWarning').mockImplementation((warning) => {
        warnings.push(warning as Error & { count?: number; type?: string | symbol });
      })
    : undefined;

  namespace.setMaxListeners(1);
  namespace.on('crowded', () => {});
  namespace.on('crowded', () => {});
  namespace.on('crowded', () => {});
  serverSocket.setMaxListeners(1);
  serverSocket.on('crowded', () => {});
  serverSocket.on('crowded', () => {});
  serverSocket.on('crowded', () => {});
  parent.setMaxListeners(0);
  for (let index = 0; index < 11; index += 1) {
    parent.on('connection', () => {});
  }
  const child = ctx.openClient({ namespace: '/listener-warning-parent' });
  await receive(child, 'connect');

  if (processHost) {
    expect(warnings).toHaveLength(3);
    expect(warnings.map(({ name, count, type }) => ({ name, count, type }))).toEqual([
      { name: 'MaxListenersExceededWarning', count: 2, type: 'crowded' },
      { name: 'MaxListenersExceededWarning', count: 2, type: 'crowded' },
      { name: 'MaxListenersExceededWarning', count: 11, type: 'connection' },
    ]);

    const hostlessNamespace = ctx.io.of('/listener-warning-without-process');
    hostlessNamespace.setMaxListeners(1);
    vi.stubGlobal('process', undefined);
    try {
      hostlessNamespace.on('crowded', () => {});
      hostlessNamespace.on('crowded', () => {});
    } finally {
      vi.unstubAllGlobals();
    }
    expect(hostlessNamespace.listenerCount('crowded')).toBe(2);
  }
  warningSpy?.mockRestore();
});

it('Namespace removal and filtered counts follow Node EventEmitter', () => {
  const namespace = ctx.io.of('/namespace-removal');
  const listener = () => {};

  expect(namespace.listeners('missing')).toEqual([]);
  expect(namespace.rawListeners('missing')).toEqual([]);

  namespace.on('event', listener);
  namespace.once('event', listener);
  expect(namespace.listenerCount('event', listener)).toBe(2);
  expect(namespace.removeListener('event', listener)).toBe(namespace);
  expect(namespace.listenerCount('event', listener)).toBe(1);
  expect(() => namespace.removeListener('event', undefined as unknown as typeof listener)).toThrow(
    TypeError,
  );

  namespace.on('other', listener);
  expect(namespace.removeAllListeners()).toBe(namespace);
  expect(namespace.eventNames()).toEqual([]);
});

it('Node eventNames uses property-key order for integers, strings, and symbols', async () => {
  const namespace = ctx.io.of('/event-name-order');
  const { serverSocket } = await ctx.connectClient();
  const listener = () => {};
  const symbol = Symbol('event');

  for (const emitter of [namespace, serverSocket]) {
    emitter.addListener('10', listener);
    emitter.addListener('2', listener);
    emitter.addListener('alpha', listener);
    emitter.addListener(symbol, listener);
  }

  expect(namespace.eventNames()).toEqual(['2', '10', 'alpha', symbol]);
  expect(serverSocket.eventNames()).toEqual(['2', '10', 'error', 'alpha', symbol]);
});

it('Namespace meta-events collide with Socket.IO reserved outgoing names', () => {
  const namespace = ctx.io.of('/namespace-meta-events');
  const direct = () => {};

  namespace.on('newListener', () => {});
  expect(() => namespace.on('tracked', direct)).toThrow('"newListener" is a reserved event name');
  expect(namespace.listenerCount('tracked')).toBe(0);

  namespace.removeAllListeners();
  namespace.on('tracked', direct);
  namespace.on('removeListener', () => {});
  expect(() => namespace.removeListener('tracked', direct)).toThrow(
    '"removeListener" is a reserved event name',
  );
  expect(namespace.listenerCount('tracked')).toBe(0);
});

it('Server delegates the newListener collision to the root Namespace', () => {
  const root = ctx.io.of('/');

  ctx.io.on('newListener', () => {});
  expect(() => ctx.io.on('tracked', () => {})).toThrow('"newListener" is a reserved event name');
  expect(root.listenerCount('tracked')).toBe(0);
});

it('server Socket meta-events collide before add and after once removal', async () => {
  const { serverSocket } = await ctx.connectClient();
  const once = vi.fn();

  serverSocket.on('newListener', () => {});
  expect(() => serverSocket.on('added', () => {})).toThrow(
    '"newListener" is a reserved event name',
  );
  expect(serverSocket.listenerCount('added')).toBe(0);

  serverSocket.removeAllListeners();
  serverSocket.once('tracked', once);
  serverSocket.on('removeListener', () => {});
  const wrapper = serverSocket.rawListeners('tracked')[0];

  expect(() => wrapper?.()).toThrow('"removeListener" is a reserved event name');
  expect(serverSocket.listenerCount('tracked')).toBe(0);
  expect(once).not.toHaveBeenCalled();
});

it('client source and declaration aliases share component-emitter identity', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const received: string[] = [];
  const listener = (value: string): void => {
    received.push(value);
  };

  expect(client.addEventListener).toBe(client.on);
  expect(client.removeListener).toBe(client.off);
  expect(client.removeAllListeners).toBe(client.off);
  expect(client.removeEventListener).toBe(client.off);

  expect(client.addEventListener('aliased', listener)).toBe(client);
  expect(client.removeEventListener('aliased', listener)).toBe(client);
  client.addEventListener('kept', listener);
  expect(client.removeListener('kept', listener)).toBe(client);
  client.addEventListener('cleared', listener);
  expect(client.removeAllListeners('cleared')).toBe(client);

  const marked = receive(client, 'marker');
  serverSocket.emit('aliased', 'removed');
  serverSocket.emit('kept', 'removed');
  serverSocket.emit('cleared', 'removed');
  serverSocket.emit('marker');
  await marked;

  expect(received).toEqual([]);
});

it('client removeAllListeners with no event clears every ordinary listener', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const received: string[] = [];

  client.on('first', () => received.push('first'));
  client.on('second', () => received.push('second'));
  expect(client.removeAllListeners()).toBe(client);

  const marked = receive(client, 'marker');
  serverSocket.emit('first');
  serverSocket.emit('second');
  serverSocket.emit('marker');
  await marked;

  expect(received).toEqual([]);
});
