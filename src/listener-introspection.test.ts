import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

const ctx = setupServer();

it('a fresh server socket exposes only its internal error listener', async () => {
  const { serverSocket } = await ctx.connectClient();

  expect(serverSocket.eventNames()).toEqual(['error']);
  expect(serverSocket.listenerCount('error')).toBe(1);
  expect(serverSocket.listeners('error')).toHaveLength(1);
  expect(serverSocket.listeners('error')).not.toBe(serverSocket.listeners('error'));
  expect(serverSocket.listeners('missing')).toEqual([]);
  expect(serverSocket.listeners('missing')).not.toBe(serverSocket.listeners('missing'));
  expect(serverSocket.listenerCount('missing')).toBe(0);
  expect('hasListeners' in serverSocket).toBe(false);
});

it('server listeners are fresh snapshots with duplicates and unwrapped once callbacks', async () => {
  const { serverSocket } = await ctx.connectClient();
  const regular = () => {};
  const once = () => {};
  const injected = () => {};

  serverSocket.on('event', regular);
  serverSocket.on('event', regular);
  serverSocket.once('event', once);
  serverSocket.on('disconnect', () => {});

  const snapshot = serverSocket.listeners('event');
  expect(snapshot).toEqual([regular, regular, once]);
  expect(snapshot).not.toBe(serverSocket.listeners('event'));
  snapshot.push(injected);
  expect(serverSocket.listeners('event')).toEqual([regular, regular, once]);
  expect(serverSocket.listenerCount('event')).toBe(3);
  expect(serverSocket.eventNames()).toEqual(['error', 'event', 'disconnect']);
});

it('server listenerCount filters direct and once registrations for string and symbol names', async () => {
  const { serverSocket } = await ctx.connectClient();
  const direct = () => {};
  const onceOriginal = () => {};
  const other = () => {};
  const symbol = Symbol('event');
  const emitter = serverSocket as unknown as {
    on(event: string | symbol, listener: () => void): unknown;
    once(event: string | symbol, listener: () => void): unknown;
  };

  emitter.on('filtered', direct);
  emitter.on('filtered', direct);
  emitter.once('filtered', onceOriginal);
  emitter.on('filtered', other);
  emitter.on(symbol, direct);
  emitter.on(symbol, direct);
  emitter.once(symbol, onceOriginal);

  expect(serverSocket.listenerCount('filtered')).toBe(4);
  expect(serverSocket.listenerCount('filtered', direct)).toBe(2);
  expect(serverSocket.listenerCount('filtered', onceOriginal)).toBe(1);
  expect(serverSocket.listenerCount('filtered', other)).toBe(1);
  expect(serverSocket.listenerCount('filtered', () => {})).toBe(0);
  expect(serverSocket.listenerCount(symbol)).toBe(3);
  expect(serverSocket.listenerCount(symbol, direct)).toBe(2);
  expect(serverSocket.listenerCount(symbol, onceOriginal)).toBe(1);
  expect(serverSocket.eventNames()).toContain(symbol);
});

it('server event names delete empty keys and reinsert them at the end', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const listener = () => {};

  serverSocket.on('first', listener);
  serverSocket.on('second', listener);
  serverSocket.removeAllListeners('first');
  serverSocket.on('third', listener);
  serverSocket.on('first', listener);
  expect(serverSocket.eventNames()).toEqual(['error', 'second', 'third', 'first']);

  serverSocket.off('first', listener);
  expect(serverSocket.listenerCount('first')).toBe(0);
  expect(serverSocket.eventNames()).toEqual(['error', 'second', 'third']);

  const received = new Promise<void>((resolve) => serverSocket.once('consumed', () => resolve()));
  const marked = new Promise<void>((resolve) => serverSocket.once('marker', () => resolve()));
  client.emit('consumed');
  client.emit('marker');
  await Promise.all([received, marked]);
  expect(serverSocket.listenerCount('consumed')).toBe(0);
  expect(serverSocket.eventNames()).toEqual(['error', 'second', 'third']);
});

it('client listeners expose the live array and component-emitter once wrapper', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const regular = () => hits.push('regular');
  const once = () => hits.push('once');
  const injected = () => hits.push('injected');

  expect(client.listeners('missing')).not.toBe(client.listeners('missing'));
  expect(client.hasListeners('missing')).toBe(false);
  expect('listenerCount' in client).toBe(false);
  expect('eventNames' in client).toBe(false);

  client.on('event', regular);
  client.on('event', regular);
  client.once('event', once);
  const live = client.listeners('event');
  const wrapper = live[2] as typeof once & { fn?: typeof once };
  expect(client.listeners('event')).toBe(live);
  expect(wrapper).not.toBe(once);
  expect(wrapper.fn).toBe(once);

  live.push(injected);
  const marked = new Promise<void>((resolve) => client.once('marker', () => resolve()));
  serverSocket.emit('event');
  serverSocket.emit('marker');
  await marked;

  expect(hits).toEqual(['regular', 'regular', 'once', 'injected']);
  expect(client.listeners('event')).toBe(live);
  expect(live).toEqual([regular, regular, injected]);

  live.length = 0;
  expect(client.hasListeners('event')).toBe(false);
  expect(client.listeners('event')).toBe(live);
  client.off('event');
  expect(client.listeners('event')).not.toBe(live);
});

it('client last-off and once exhaustion empty and detach the old backing array', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const listener = () => {};

  client.on('kept', listener);
  const kept = client.listeners('kept');
  client.off('kept', () => {});
  expect(client.listeners('kept')).toBe(kept);
  expect(kept).toEqual([listener]);
  expect(client.hasListeners('kept')).toBe(true);

  client.on('last', listener);
  const removed = client.listeners('last');
  client.off('last', listener);
  expect(removed).toEqual([]);
  expect(client.listeners('last')).not.toBe(removed);
  expect(client.listeners('last')).not.toBe(client.listeners('last'));
  expect(client.hasListeners('last')).toBe(false);

  const received = new Promise<void>((resolve) => client.once('consumed', () => resolve()));
  const consumed = client.listeners('consumed');
  const marked = new Promise<void>((resolve) => client.once('marker', () => resolve()));
  serverSocket.emit('consumed');
  serverSocket.emit('marker');
  await Promise.all([received, marked]);

  expect(consumed).toEqual([]);
  expect(client.listeners('consumed')).not.toBe(consumed);
  expect(client.hasListeners('consumed')).toBe(false);
});

it('client introspection is available before connect for reserved events', async () => {
  const client = ctx.openClient();
  let resolveConnected!: () => void;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });
  const listener = () => resolveConnected();

  client.once('connect', listener);
  const live = client.listeners('connect');
  const wrapper = live[0] as typeof listener & { fn?: typeof listener };
  expect(client.hasListeners('connect')).toBe(true);
  expect(wrapper.fn).toBe(listener);

  await connected;
  expect(live).toEqual([]);
  expect(client.listeners('connect')).not.toBe(live);
  expect(client.hasListeners('connect')).toBe(false);
});
