import { expect, it } from 'vitest';
import { observeDisconnect } from './test-events';
import { setupServer } from './setup-server';

const ctx = setupServer();

it('a server-side catch-all fires for every incoming event with the name and args', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: Array<[unknown, unknown[]]> = [];
  serverSocket.onAny((event: unknown, ...args: unknown[]) => seen.push([event, args]));
  const got = new Promise<void>((resolve) => serverSocket.on('greet', () => resolve()));
  client.emit('greet', 'hi', 1);
  await got;
  expect(seen).toEqual([['greet', ['hi', 1]]]);
});

it('a catch-all runs before the specific listener for the same event', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  serverSocket.onAny(() => order.push('any'));
  const done = new Promise<void>((resolve) =>
    serverSocket.on('ping', () => {
      order.push('specific');
      resolve();
    }),
  );
  client.emit('ping');
  await done;
  expect(order).toEqual(['any', 'specific']);
});

it('a catch-all does not fire for the reserved disconnect events', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const events: unknown[] = [];
  serverSocket.onAny((event: unknown) => events.push(event));
  const seen = new Promise<void>((resolve) => serverSocket.on('regular', () => resolve()));
  const { disconnected } = observeDisconnect(serverSocket);
  client.emit('regular');
  await seen;
  client.disconnect();
  await disconnected;
  expect(events).toEqual(['regular']);
});

it('offAny(listener) removes one catch-all, offAny() removes all', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let a = 0;
  let b = 0;
  const onA = () => {
    a += 1;
  };
  const onB = () => {
    b += 1;
  };
  serverSocket.onAny(onA);
  serverSocket.onAny(onB);
  const roundtrip = (event: string) =>
    new Promise<void>((resolve) => {
      serverSocket.once(event, () => resolve());
      client.emit(event);
    });
  await roundtrip('e1');
  serverSocket.offAny(onA);
  await roundtrip('e2');
  serverSocket.offAny();
  await roundtrip('e3');
  expect(a).toBe(1);
  expect(b).toBe(2);
});

// Catch-all listeners are stored in an array too, not de-duplicated (#125).

it('the same catch-all registered twice fires once per registration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: string[] = [];
  const any = () => seen.push('any');
  serverSocket.onAny(any);
  serverSocket.onAny(any);
  const done = new Promise<void>((resolve) => serverSocket.once('ev', () => resolve()));
  client.emit('ev');
  await done;
  expect(seen).toEqual(['any', 'any']);
});

it('offAny removes one occurrence of a doubly-registered catch-all', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: string[] = [];
  const any = () => seen.push('any');
  serverSocket.onAny(any);
  serverSocket.onAny(any);
  serverSocket.offAny(any);
  const done = new Promise<void>((resolve) => serverSocket.once('ev', () => resolve()));
  client.emit('ev');
  await done;
  expect(seen).toEqual(['any']);
});

it('a catch-all receives an ack callback as the last argument', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let anyArgs: unknown[] = [];
  serverSocket.onAny((...args: unknown[]) => {
    anyArgs = args;
  });
  serverSocket.on('ask', (_data: unknown, ack: (v: string) => void) => ack('ok'));
  const answer = await client.emitWithAck('ask', 'q');
  expect(answer).toBe('ok');
  expect(anyArgs[0]).toBe('ask');
  expect(anyArgs[1]).toBe('q');
  expect(typeof anyArgs[2]).toBe('function');
});

it('a client-side catch-all fires for a server emit', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: Array<[unknown, unknown[]]> = [];
  client.onAny((event: unknown, ...args: unknown[]) => seen.push([event, args]));
  const got = new Promise<void>((resolve) => client.on('news', () => resolve()));
  serverSocket.emit('news', 'update');
  await got;
  expect(seen).toEqual([['news', ['update']]]);
});

// The catch-all is symmetric across the two sides (measured on 4.8.3): the client
// side must be exercised directly, since it is under-tested next to the server.

it('a client catch-all runs before the specific listener for the same event', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  client.onAny(() => order.push('any'));
  const done = new Promise<void>((resolve) =>
    client.on('ping', () => {
      order.push('specific');
      resolve();
    }),
  );
  serverSocket.emit('ping');
  await done;
  expect(order).toEqual(['any', 'specific']);
});

it('a client catch-all does not fire for the reserved disconnect event', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const events: unknown[] = [];
  client.onAny((event: unknown) => events.push(event));
  const seen = new Promise<void>((resolve) => client.on('regular', () => resolve()));
  const gone = new Promise<void>((resolve) => client.on('disconnect', () => resolve()));
  serverSocket.emit('regular');
  await seen;
  serverSocket.disconnect();
  await gone;
  expect(events).toEqual(['regular']);
});

it('client offAny(listener) removes one catch-all, offAny() removes all', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let a = 0;
  let b = 0;
  const onA = () => {
    a += 1;
  };
  const onB = () => {
    b += 1;
  };
  client.onAny(onA);
  client.onAny(onB);
  const roundtrip = (event: string) =>
    new Promise<void>((resolve) => {
      client.once(event, () => resolve());
      serverSocket.emit(event);
    });
  await roundtrip('e1');
  client.offAny(onA);
  await roundtrip('e2');
  client.offAny();
  await roundtrip('e3');
  expect(a).toBe(1);
  expect(b).toBe(2);
});

it('server prependAny listeners run newest-first before onAny listeners', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  serverSocket.onAny(() => order.push('on'));
  serverSocket.prependAny(() => order.push('first prepend'));
  serverSocket.prependAny(() => order.push('second prepend'));
  const done = new Promise<void>((resolve) => serverSocket.once('ordered', () => resolve()));

  client.emit('ordered');
  await done;

  expect(order).toEqual(['second prepend', 'first prepend', 'on']);
});

it('client prependAny listeners run newest-first before onAny listeners', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  client.onAny(() => order.push('on'));
  client.prependAny(() => order.push('first prepend'));
  client.prependAny(() => order.push('second prepend'));
  const done = new Promise<void>((resolve) => client.once('ordered', () => resolve()));

  serverSocket.emit('ordered');
  await done;

  expect(order).toEqual(['second prepend', 'first prepend', 'on']);
});

it('server listenersAny is live and offAny removes the first matching duplicate', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: string[] = [];
  const duplicate = () => seen.push('duplicate');
  const middle = () => seen.push('middle');
  const injected = () => seen.push('injected');
  serverSocket.onAny(duplicate).onAny(middle).onAny(duplicate);

  const listeners = serverSocket.listenersAny();
  expect(serverSocket.listenersAny()).toBe(listeners);
  serverSocket.offAny(duplicate);
  expect(listeners).toEqual([middle, duplicate]);
  listeners.push(injected);
  const done = new Promise<void>((resolve) => serverSocket.once('live', () => resolve()));

  client.emit('live');
  await done;

  expect(seen).toEqual(['middle', 'duplicate', 'injected']);
});

it('client listenersAny is live and offAny removes the first matching duplicate', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: string[] = [];
  const duplicate = () => seen.push('duplicate');
  const middle = () => seen.push('middle');
  const injected = () => seen.push('injected');
  client.onAny(duplicate).onAny(middle).onAny(duplicate);

  const listeners = client.listenersAny();
  expect(client.listenersAny()).toBe(listeners);
  client.offAny(duplicate);
  expect(listeners).toEqual([middle, duplicate]);
  listeners.push(injected);
  const done = new Promise<void>((resolve) => client.once('live', () => resolve()));

  serverSocket.emit('live');
  await done;

  expect(seen).toEqual(['middle', 'duplicate', 'injected']);
});

it('offAny replaces both sides backing arrays and detaches earlier lookups', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];
  serverSocket.onAny(() => serverSeen.push('old'));
  client.onAny(() => clientSeen.push('old'));
  const oldServerListeners = serverSocket.listenersAny();
  const oldClientListeners = client.listenersAny();

  serverSocket.offAny().onAny(() => serverSeen.push('current'));
  client.offAny().onAny(() => clientSeen.push('current'));
  oldServerListeners.push(() => serverSeen.push('detached'));
  oldClientListeners.push(() => clientSeen.push('detached'));
  expect(serverSocket.listenersAny()).not.toBe(oldServerListeners);
  expect(client.listenersAny()).not.toBe(oldClientListeners);

  const serverDone = new Promise<void>((resolve) => serverSocket.once('to-server', resolve));
  const clientDone = new Promise<void>((resolve) => client.once('to-client', resolve));
  client.emit('to-server');
  serverSocket.emit('to-client');
  await Promise.all([serverDone, clientDone]);

  expect(serverSeen).toEqual(['current']);
  expect(clientSeen).toEqual(['current']);
});

it('incoming catch-all dispatch snapshots listener mutations on both sides', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];
  const serverLate = (event: unknown) => serverSeen.push(`late:${String(event)}`);
  const clientLate = (event: unknown) => clientSeen.push(`late:${String(event)}`);
  serverSocket.onAny((event) => {
    serverSeen.push(`existing:${String(event)}`);
    serverSocket.listenersAny().push(serverLate);
  });
  client.onAny((event) => {
    clientSeen.push(`existing:${String(event)}`);
    client.listenersAny().push(clientLate);
  });
  const roundtrip = (event: string) =>
    Promise.all([
      new Promise<void>((resolve) => serverSocket.once(`server-${event}`, resolve)),
      new Promise<void>((resolve) => client.once(`client-${event}`, resolve)),
    ]);

  let done = roundtrip('first');
  client.emit('server-first');
  serverSocket.emit('client-first');
  await done;
  done = roundtrip('second');
  client.emit('server-second');
  serverSocket.emit('client-second');
  await done;

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

it('a client incoming catch-all receives the server ack callback', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let anyArgs: unknown[] = [];
  client.onAny((...args: unknown[]) => {
    anyArgs = args;
  });
  client.on('ask-client', (_data: unknown, ack: (v: string) => void) => ack('ok'));

  const answer = await serverSocket.emitWithAck('ask-client', 'q');

  expect(answer).toBe('ok');
  expect(anyArgs[0]).toBe('ask-client');
  expect(anyArgs[1]).toBe('q');
  expect(typeof anyArgs[2]).toBe('function');
});

it('empty listenersAny lookups are fresh and cannot install listeners on either side', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];
  const firstServerLookup = serverSocket.listenersAny();
  const firstClientLookup = client.listenersAny();
  firstServerLookup.push(() => serverSeen.push('injected'));
  firstClientLookup.push(() => clientSeen.push('injected'));

  expect(serverSocket.listenersAny()).not.toBe(firstServerLookup);
  expect(client.listenersAny()).not.toBe(firstClientLookup);
  expect(serverSocket.listenersAny()).toEqual([]);
  expect(client.listenersAny()).toEqual([]);

  const serverMarker = new Promise<void>((resolve) =>
    serverSocket.once('server-marker', () => {
      serverSeen.push('marker');
      resolve();
    }),
  );
  const clientMarker = new Promise<void>((resolve) =>
    client.once('client-marker', () => {
      clientSeen.push('marker');
      resolve();
    }),
  );
  client.emit('server-marker');
  serverSocket.emit('client-marker');
  await Promise.all([serverMarker, clientMarker]);

  expect(serverSeen).toEqual(['marker']);
  expect(clientSeen).toEqual(['marker']);
});

it('offAny on untouched sockets keeps empty lookups fresh and inert', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];

  serverSocket.offAny();
  client.offAny();
  const firstServerLookup = serverSocket.listenersAny();
  const firstClientLookup = client.listenersAny();
  firstServerLookup.push(() => serverSeen.push('injected'));
  firstClientLookup.push(() => clientSeen.push('injected'));

  expect(serverSocket.listenersAny()).not.toBe(firstServerLookup);
  expect(client.listenersAny()).not.toBe(firstClientLookup);

  const serverMarker = new Promise<void>((resolve) =>
    serverSocket.once('server-marker', () => {
      serverSeen.push('marker');
      resolve();
    }),
  );
  const clientMarker = new Promise<void>((resolve) =>
    client.once('client-marker', () => {
      clientSeen.push('marker');
      resolve();
    }),
  );
  client.emit('server-marker');
  serverSocket.emit('client-marker');
  await Promise.all([serverMarker, clientMarker]);

  expect(serverSeen).toEqual(['marker']);
  expect(clientSeen).toEqual(['marker']);
});

it('offAny detaches the old arrays and installs stable empty replacements', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverSeen: string[] = [];
  const clientSeen: string[] = [];
  serverSocket.onAny(() => {});
  client.onAny(() => {});
  const oldServerLookup = serverSocket.listenersAny();
  const oldClientLookup = client.listenersAny();

  serverSocket.offAny();
  client.offAny();

  expect(serverSocket.listenersAny()).not.toBe(oldServerLookup);
  expect(client.listenersAny()).not.toBe(oldClientLookup);
  expect(serverSocket.listenersAny()).toBe(serverSocket.listenersAny());
  expect(client.listenersAny()).toBe(client.listenersAny());
  serverSocket.listenersAny().push(() => serverSeen.push('replacement'));
  client.listenersAny().push(() => clientSeen.push('replacement'));

  const serverMarker = new Promise<void>((resolve) => serverSocket.once('server-marker', resolve));
  const clientMarker = new Promise<void>((resolve) => client.once('client-marker', resolve));
  client.emit('server-marker');
  serverSocket.emit('client-marker');
  await Promise.all([serverMarker, clientMarker]);

  expect(serverSeen).toEqual(['replacement']);
  expect(clientSeen).toEqual(['replacement']);
});
