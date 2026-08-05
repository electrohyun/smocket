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
