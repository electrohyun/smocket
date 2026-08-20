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

it('a client timeout survives an outgoing catch-all throw and is then consumed once', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const observerError = new Error('outgoing observer failed');
  client.onAnyOutgoing((event) => {
    if (event === 'bad') throw observerError;
  });
  serverSocket.on('echo', (ack: (value: string) => void) => ack('answer'));

  client.timeout(1000);
  expect(() => client.emit('bad')).toThrow(observerError);
  const first = await new Promise<unknown[]>((resolve) => {
    client.emit('echo', (...args: unknown[]) => resolve(args));
  });
  const second = await new Promise<unknown[]>((resolve) => {
    client.emit('echo', (...args: unknown[]) => resolve(args));
  });

  expect(first).toEqual([null, 'answer']);
  expect(second).toEqual(['answer']);
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

it('server prependAnyOutgoing listeners run newest-first before onAnyOutgoing listeners', async () => {
  const { serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  serverSocket.onAnyOutgoing(() => order.push('on'));
  serverSocket.prependAnyOutgoing(() => order.push('first prepend'));
  serverSocket.prependAnyOutgoing(() => order.push('second prepend'));

  serverSocket.emit('ordered');

  expect(order).toEqual(['second prepend', 'first prepend', 'on']);
});

it('client prependAnyOutgoing listeners run newest-first before onAnyOutgoing listeners', async () => {
  const { client } = await ctx.connectClient();
  const order: string[] = [];
  client.onAnyOutgoing(() => order.push('on'));
  client.prependAnyOutgoing(() => order.push('first prepend'));
  client.prependAnyOutgoing(() => order.push('second prepend'));

  client.emit('ordered');

  expect(order).toEqual(['second prepend', 'first prepend', 'on']);
});

it('server listenersAnyOutgoing is live and removes the first matching duplicate', async () => {
  const { serverSocket } = await ctx.connectClient();
  const seen: string[] = [];
  const duplicate = () => seen.push('duplicate');
  const middle = () => seen.push('middle');
  const injected = () => seen.push('injected');
  serverSocket.onAnyOutgoing(duplicate).onAnyOutgoing(middle).onAnyOutgoing(duplicate);

  const listeners = serverSocket.listenersAnyOutgoing();
  expect(serverSocket.listenersAnyOutgoing()).toBe(listeners);
  serverSocket.offAnyOutgoing(duplicate);
  expect(listeners).toEqual([middle, duplicate]);
  listeners.push(injected);
  serverSocket.emit('live');

  expect(seen).toEqual(['middle', 'duplicate', 'injected']);
});

it('client listenersAnyOutgoing is live and removes the first matching duplicate', async () => {
  const { client } = await ctx.connectClient();
  const seen: string[] = [];
  const duplicate = () => seen.push('duplicate');
  const middle = () => seen.push('middle');
  const injected = () => seen.push('injected');
  client.onAnyOutgoing(duplicate).onAnyOutgoing(middle).onAnyOutgoing(duplicate);

  const listeners = client.listenersAnyOutgoing();
  expect(client.listenersAnyOutgoing()).toBe(listeners);
  client.offAnyOutgoing(duplicate);
  expect(listeners).toEqual([middle, duplicate]);
  listeners.push(injected);
  client.emit('live');

  expect(seen).toEqual(['middle', 'duplicate', 'injected']);
});

it('offAnyOutgoing replaces both sides backing arrays and detaches earlier lookups', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];
  serverSocket.onAnyOutgoing(() => serverSeen.push('old'));
  client.onAnyOutgoing(() => clientSeen.push('old'));
  const oldServerListeners = serverSocket.listenersAnyOutgoing();
  const oldClientListeners = client.listenersAnyOutgoing();

  serverSocket.offAnyOutgoing().onAnyOutgoing(() => serverSeen.push('current'));
  client.offAnyOutgoing().onAnyOutgoing(() => clientSeen.push('current'));
  oldServerListeners.push(() => serverSeen.push('detached'));
  oldClientListeners.push(() => clientSeen.push('detached'));
  expect(serverSocket.listenersAnyOutgoing()).not.toBe(oldServerListeners);
  expect(client.listenersAnyOutgoing()).not.toBe(oldClientListeners);

  serverSocket.emit('server-outgoing');
  client.emit('client-outgoing');

  expect(serverSeen).toEqual(['current']);
  expect(clientSeen).toEqual(['current']);
});

it('outgoing catch-all dispatch snapshots listener mutations on both sides', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];
  const serverLate = (event: unknown) => serverSeen.push(`late:${String(event)}`);
  const clientLate = (event: unknown) => clientSeen.push(`late:${String(event)}`);
  serverSocket.onAnyOutgoing((event) => {
    serverSeen.push(`existing:${String(event)}`);
    serverSocket.listenersAnyOutgoing().push(serverLate);
  });
  client.onAnyOutgoing((event) => {
    clientSeen.push(`existing:${String(event)}`);
    client.listenersAnyOutgoing().push(clientLate);
  });

  serverSocket.emit('server-first');
  client.emit('client-first');
  serverSocket.emit('server-second');
  client.emit('client-second');

  expect(serverSeen).toEqual([
    'existing:server-first',
    'existing:server-second',
    'late:server-second',
  ]);
  expect(clientSeen).toEqual([
    'existing:client-first',
    'existing:client-second',
    'late:client-second',
  ]);
});

it('the client outgoing catch-all omits ack callbacks for emit and emitWithAck', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: unknown[][] = [];
  client.onAnyOutgoing((...args: unknown[]) => seen.push(args));
  serverSocket.on('ask-client', (_q: unknown, ack: (v: string) => void) => ack('ok'));

  const callbackAnswer = new Promise<string>((resolve) => {
    client.emit('ask-client', 'q1', (value: string) => resolve(value));
  });
  const [emitAnswer, answer] = await Promise.all([
    callbackAnswer,
    client.emitWithAck('ask-client', 'q2'),
  ]);

  expect(emitAnswer).toBe('ok');
  expect(answer).toBe('ok');
  expect(seen).toEqual([
    ['ask-client', 'q1'],
    ['ask-client', 'q2'],
  ]);
});

it('empty listenersAnyOutgoing lookups are fresh and cannot install listeners on either side', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];
  const firstServerLookup = serverSocket.listenersAnyOutgoing();
  const firstClientLookup = client.listenersAnyOutgoing();
  firstServerLookup.push(() => serverSeen.push('injected'));
  firstClientLookup.push(() => clientSeen.push('injected'));

  expect(serverSocket.listenersAnyOutgoing()).not.toBe(firstServerLookup);
  expect(client.listenersAnyOutgoing()).not.toBe(firstClientLookup);
  expect(serverSocket.listenersAnyOutgoing()).toEqual([]);
  expect(client.listenersAnyOutgoing()).toEqual([]);

  serverSocket.emit('server-marker');
  client.emit('client-marker');

  expect(serverSeen).toEqual([]);
  expect(clientSeen).toEqual([]);
});

it('offAnyOutgoing on untouched sockets keeps empty lookups fresh and inert', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];

  serverSocket.offAnyOutgoing();
  client.offAnyOutgoing();
  const firstServerLookup = serverSocket.listenersAnyOutgoing();
  const firstClientLookup = client.listenersAnyOutgoing();
  firstServerLookup.push(() => serverSeen.push('injected'));
  firstClientLookup.push(() => clientSeen.push('injected'));

  expect(serverSocket.listenersAnyOutgoing()).not.toBe(firstServerLookup);
  expect(client.listenersAnyOutgoing()).not.toBe(firstClientLookup);

  serverSocket.emit('server-marker');
  client.emit('client-marker');

  expect(serverSeen).toEqual([]);
  expect(clientSeen).toEqual([]);
});

it('offAnyOutgoing detaches the old arrays and installs stable empty replacements', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];
  serverSocket.onAnyOutgoing(() => {});
  client.onAnyOutgoing(() => {});
  const oldServerLookup = serverSocket.listenersAnyOutgoing();
  const oldClientLookup = client.listenersAnyOutgoing();

  serverSocket.offAnyOutgoing();
  client.offAnyOutgoing();

  expect(serverSocket.listenersAnyOutgoing()).not.toBe(oldServerLookup);
  expect(client.listenersAnyOutgoing()).not.toBe(oldClientLookup);
  expect(serverSocket.listenersAnyOutgoing()).toBe(serverSocket.listenersAnyOutgoing());
  expect(client.listenersAnyOutgoing()).toBe(client.listenersAnyOutgoing());
  serverSocket.listenersAnyOutgoing().push(() => serverSeen.push('replacement'));
  client.listenersAnyOutgoing().push(() => clientSeen.push('replacement'));

  serverSocket.emit('server-marker');
  client.emit('client-marker');

  expect(serverSeen).toEqual(['replacement']);
  expect(clientSeen).toEqual(['replacement']);
});
