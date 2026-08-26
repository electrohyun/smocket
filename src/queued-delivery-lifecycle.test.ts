import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { observeDisconnect, receive, track } from './test-events';

const ctx = setupServer();

const packetMiddlewareCases = [
  ['without packet middleware', false],
  ['with packet middleware', true],
] as const;

it.each(packetMiddlewareCases)(
  'drops client packets queued behind a server Socket disconnect %s',
  async (_label, withMiddleware) => {
    const { client, serverSocket } = await ctx.connectClient();
    if (withMiddleware) serverSocket.use((_event, next) => next());
    const queued = track(serverSocket, 'queued');
    serverSocket.on('terminate', () => serverSocket.disconnect());
    const disconnected = receive(client, 'disconnect');

    client.emit('terminate');
    client.emit('queued');
    await disconnected;

    const nextConnection = ctx.nextConnection();
    const reconnected = receive(client, 'connect');
    client.connect();
    const currentSocket = await nextConnection;
    await reconnected;
    const marker = new Promise<void>((resolve) => currentSocket.once('marker', () => resolve()));
    client.emit('marker', 'fresh');
    await marker;

    expect(queued.received).toBe(false);
  },
);

it('drops server packets queued behind a client disconnect', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const queued = track(client, 'queued');
  client.on('terminate', () => client.disconnect());
  const disconnected = receive(client, 'disconnect');

  serverSocket.emit('terminate');
  serverSocket.emit('queued');
  await disconnected;

  const nextConnection = ctx.nextConnection();
  const reconnected = receive(client, 'connect');
  client.connect();
  const currentSocket = await nextConnection;
  await reconnected;
  const marker = receive(client, 'marker');
  currentSocket.emit('marker', 'fresh');
  await marker;

  expect(queued.received).toBe(false);
});

it.each(packetMiddlewareCases)(
  'drops client packets queued behind Server.close() %s',
  async (_label, withMiddleware) => {
    const { client, serverSocket } = await ctx.connectClient();
    if (withMiddleware) serverSocket.use((_event, next) => next());
    const queued = track(serverSocket, 'queued');
    let closing!: Promise<void>;
    serverSocket.on('terminate', () => {
      closing = Promise.resolve(ctx.io.close());
    });

    client.emit('terminate');
    client.emit('queued');
    await receive(client, 'disconnect');
    await closing;

    expect(queued.received).toBe(false);
  },
);

it.each(packetMiddlewareCases)(
  'drains client packets queued before client.disconnect() %s',
  async (_label, withMiddleware) => {
    const { client, serverSocket } = await ctx.connectClient();
    if (withMiddleware) serverSocket.use((_event, next) => next());
    const queued = track(serverSocket, 'queued');
    const marker = new Promise<void>((resolve) =>
      serverSocket.once('queued-marker', () => resolve()),
    );
    serverSocket.on('terminate', () => client.disconnect());

    client.emit('terminate');
    client.emit('queued');
    client.emit('queued-marker');
    await marker;

    expect(queued.received).toBe(true);
  },
);

it('drains server packets queued before Server.close()', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const queued = track(client, 'queued');
  let closing!: Promise<void>;
  client.on('terminate', () => {
    closing = Promise.resolve(ctx.io.close());
  });

  serverSocket.emit('terminate');
  serverSocket.emit('queued');
  await receive(client, 'disconnect');
  await closing;

  expect(queued.received).toBe(true);
});

it('preserves FIFO in both directions while the connection remains active', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const clientOrder: string[] = [];
  const serverOrder: string[] = [];
  serverSocket.on('client-order', (value: string) => clientOrder.push(value));
  client.on('server-order', (value: string) => serverOrder.push(value));

  const clientMarker = new Promise<void>((resolve) =>
    serverSocket.once('client-marker', () => resolve()),
  );
  const serverMarker = receive(client, 'server-marker');
  client.emit('client-order', 'first');
  client.emit('client-order', 'second');
  client.emit('client-marker');
  serverSocket.emit('server-order', 'first');
  serverSocket.emit('server-order', 'second');
  serverSocket.emit('server-marker', 'done');

  await Promise.all([clientMarker, serverMarker]);
  expect(clientOrder).toEqual(['first', 'second']);
  expect(serverOrder).toEqual(['first', 'second']);
});
