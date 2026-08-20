import { expect, it } from 'vitest';
import { observeDisconnect } from './test-events';
import { setupServer } from './setup-server';

const ctx = setupServer();

it('off removes only the named registration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const l1 = () => hits.push('l1');
  serverSocket.on('ev', l1);
  const done = new Promise<void>((resolve) =>
    serverSocket.on('ev', () => {
      hits.push('l2');
      resolve();
    }),
  );
  serverSocket.off('ev', l1);
  client.emit('ev');
  await done;
  expect(hits).toEqual(['l2']);
});

// Listeners are stored in arrays, not de-duplicated: registering the same
// callback twice calls it once per registration, and off removes one occurrence.

it('the same callback registered twice is called once per registration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const listener = () => hits.push('x');
  serverSocket.on('ev', listener);
  serverSocket.on('ev', listener);
  const done = new Promise<void>((resolve) => serverSocket.on('marker', () => resolve()));
  client.emit('ev');
  client.emit('marker');
  await done;
  expect(hits).toEqual(['x', 'x']);
});

it('off removes one occurrence of a doubly-registered callback, leaving the rest', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const listener = () => hits.push('x');
  serverSocket.on('ev', listener);
  serverSocket.on('ev', listener);
  serverSocket.off('ev', listener);
  const done = new Promise<void>((resolve) => serverSocket.on('marker', () => resolve()));
  client.emit('ev');
  client.emit('marker');
  await done;
  expect(hits).toEqual(['x']);
});

it('removeAllListeners(event) clears every listener for that event only', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  serverSocket.on('ev', () => hits.push('ev-a'));
  serverSocket.on('ev', () => hits.push('ev-b'));
  serverSocket.removeAllListeners('ev');
  const done = new Promise<void>((resolve) =>
    serverSocket.on('other', () => {
      hits.push('other');
      resolve();
    }),
  );
  client.emit('ev');
  client.emit('other');
  await done;
  expect(hits).toEqual(['other']);
});

it('removeAllListeners() clears listeners for every event', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  serverSocket.on('a', () => hits.push('a'));
  serverSocket.on('b', () => hits.push('b'));
  serverSocket.removeAllListeners();
  const done = new Promise<void>((resolve) => serverSocket.on('marker', () => resolve()));
  client.emit('a');
  client.emit('b');
  client.emit('marker');
  await done;
  expect(hits).toEqual([]);
});

it('removeAllListeners() clears a disconnect handler, but the socket still tears down', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let firstFired = false;
  serverSocket.on('disconnect', () => {
    firstFired = true;
  });
  serverSocket.removeAllListeners();
  const tornDown = new Promise<void>((resolve) => serverSocket.on('disconnect', () => resolve()));
  client.disconnect();
  await tornDown;
  expect(firstFired).toBe(false);
});

it('off and removeAllListeners are no-ops for unknown listeners or events', async () => {
  const { serverSocket } = await ctx.connectClient();
  expect(() => {
    serverSocket.off('ev', () => undefined);
    serverSocket.removeAllListeners('never-registered');
  }).not.toThrow();
});

it('catch-all removal is a no-op for an unknown listener', async () => {
  const { client } = await ctx.connectClient();
  const kept = () => {};
  const unknown = () => {};

  client.onAny(kept);
  client.onAnyOutgoing(kept);

  expect(client.offAny(unknown)).toBe(client);
  expect(client.offAnyOutgoing(unknown)).toBe(client);
  expect(client.listenersAny()).toEqual([kept]);
  expect(client.listenersAnyOutgoing()).toEqual([kept]);
});

it('a listener removed during its own dispatch still runs for that dispatch', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const l2 = () => hits.push('l2');
  const done = new Promise<void>((resolve) => {
    serverSocket.on('ev', () => {
      hits.push('l1');
      serverSocket.off('ev', l2);
      resolve();
    });
    serverSocket.on('ev', l2);
  });
  client.emit('ev');
  await done;
  expect(hits).toEqual(['l1', 'l2']);
});

// A once registration is removable by its original listener, on both sides: real
// socket.io stores the original on the wrapper and compares against it.

it('off removes a once registration by its original listener', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const listener = () => hits.push('once');
  serverSocket.once('ev', listener);
  serverSocket.off('ev', listener);
  const done = new Promise<void>((resolve) => serverSocket.on('marker', () => resolve()));
  client.emit('ev');
  client.emit('marker');
  await done;
  expect(hits).toEqual([]);
});

it('off removes a once registration on the client side too', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const listener = () => hits.push('once');
  client.once('ev', listener);
  client.off('ev', listener);
  const done = new Promise<void>((resolve) => client.on('marker', () => resolve()));
  serverSocket.emit('ev');
  serverSocket.emit('marker');
  await done;
  expect(hits).toEqual([]);
});

// Which occurrence off removes when the same function is registered both ways
// splits by side (measured on 4.8.3): Node's emitter removes the last match, so
// off leaves the earlier registration; component-emitter removes the first, so
// it leaves the later one.

it('server off removes the last match, leaving the earlier once registration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const l = () => hits.push('x');
  serverSocket.once('ev', l);
  serverSocket.on('ev', l);
  serverSocket.off('ev', l);
  const done = new Promise<void>((resolve) => serverSocket.on('marker', () => resolve()));
  client.emit('ev');
  client.emit('ev');
  client.emit('marker');
  await done;
  expect(hits).toEqual(['x']); // the once survived and fired a single time
});

it('server off removes the last match, leaving the earlier on registration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const l = () => hits.push('x');
  serverSocket.on('ev', l);
  serverSocket.once('ev', l);
  serverSocket.off('ev', l);
  const done = new Promise<void>((resolve) => serverSocket.on('marker', () => resolve()));
  client.emit('ev');
  client.emit('ev');
  client.emit('marker');
  await done;
  expect(hits).toEqual(['x', 'x']); // the on survived and fired on both emits
});

it('client off removes the first match, leaving the later on registration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const l = () => hits.push('x');
  client.once('ev', l);
  client.on('ev', l);
  client.off('ev', l);
  const done = new Promise<void>((resolve) => client.on('marker', () => resolve()));
  serverSocket.emit('ev');
  serverSocket.emit('ev');
  serverSocket.emit('marker');
  await done;
  expect(hits).toEqual(['x', 'x']); // the on survived and fired on both emits
});

it('client off removes the first match, leaving the later once registration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const l = () => hits.push('x');
  client.on('ev', l);
  client.once('ev', l);
  client.off('ev', l);
  const done = new Promise<void>((resolve) => client.on('marker', () => resolve()));
  serverSocket.emit('ev');
  serverSocket.emit('ev');
  serverSocket.emit('marker');
  await done;
  expect(hits).toEqual(['x']); // the once survived and fired a single time
});

// The client side must be exercised directly: the shared emitter is not enough,
// because off(event) splits by side (see below).

it('client off removes only the named registration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  const first = () => hits.push('first');
  client.on('ev', first);
  const done = new Promise<void>((resolve) =>
    client.on('ev', () => {
      hits.push('second');
      resolve();
    }),
  );
  client.off('ev', first);
  serverSocket.emit('ev');
  await done;
  expect(hits).toEqual(['second']);
});

it('client removeAllListeners(event) clears that event only', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  client.on('ev', () => hits.push('ev-a'));
  client.on('ev', () => hits.push('ev-b'));
  client.removeAllListeners('ev');
  const done = new Promise<void>((resolve) =>
    client.on('other', () => {
      hits.push('other');
      resolve();
    }),
  );
  serverSocket.emit('ev');
  serverSocket.emit('other');
  await done;
  expect(hits).toEqual(['other']);
});

// off(event) without a listener splits by side: the server socket is Node's
// emitter (throws), the client socket is component-emitter (clears the event).

it('server off(event) without a listener throws', async () => {
  const { serverSocket } = await ctx.connectClient();
  const bulk = serverSocket as unknown as { off(event: string): void };
  expect(() => bulk.off('ev')).toThrow(TypeError);
});

it('client off(event) without a listener clears that event', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const hits: string[] = [];
  client.on('ev', () => hits.push('ev'));
  client.off('ev');
  const done = new Promise<void>((resolve) => client.on('marker', () => resolve()));
  serverSocket.emit('ev');
  serverSocket.emit('marker');
  await done;
  expect(hits).toEqual([]);
});

it('removeAllListeners() does not stop room cleanup', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  await serverSocket.join('room-1');
  serverSocket.removeAllListeners();
  const { disconnecting, disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  expect(await disconnecting).toContain('room-1');
  expect((await disconnected).size).toBe(0);
});

it('removeAllListeners() leaves catch-all listeners in place', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let anyFired = false;
  serverSocket.onAny(() => {
    anyFired = true;
  });
  serverSocket.removeAllListeners();
  const done = new Promise<void>((resolve) => serverSocket.onAny(() => resolve()));
  client.emit('ev');
  await done;
  expect(anyFired).toBe(true);
});
