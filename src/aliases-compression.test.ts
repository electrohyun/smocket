import { expect, it } from 'vitest';
import type { ClientSocketContract, ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { observeDisconnect, receive, track } from './test-events';

const ctx = setupServer();

function messages(
  socket: ClientSocketContract | ServerSocketContract,
  count: number,
): Promise<unknown[]> {
  return new Promise((resolve) => {
    const seen: unknown[] = [];
    const on = socket.on as (event: string, listener: (value: unknown) => void) => unknown;
    on.call(socket, 'message', (value) => {
      seen.push(value);
      if (seen.length === count) resolve(seen);
    });
  });
}

it('Server and Namespace send and write broadcast message and return their receiver', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  const firstMessages = messages(first.client, 4);
  const secondMessages = messages(second.client, 4);
  const firstOutgoing: string[] = [];
  const secondOutgoing: string[] = [];
  first.serverSocket.onAnyOutgoing((event) => firstOutgoing.push(String(event)));
  second.serverSocket.onAnyOutgoing((event) => secondOutgoing.push(String(event)));

  expect(ctx.io.send('server-send')).toBe(ctx.io);
  expect(ctx.io.write('server-write')).toBe(ctx.io);
  const namespace = ctx.io.of('/');
  expect(namespace.send('namespace-send')).toBe(namespace);
  expect(namespace.write('namespace-write')).toBe(namespace);

  await expect(firstMessages).resolves.toEqual([
    'server-send',
    'server-write',
    'namespace-send',
    'namespace-write',
  ]);
  await expect(secondMessages).resolves.toEqual([
    'server-send',
    'server-write',
    'namespace-send',
    'namespace-write',
  ]);
  expect(firstOutgoing).toEqual(['message', 'message', 'message', 'message']);
  expect(secondOutgoing).toEqual(['message', 'message', 'message', 'message']);
});

it('a dynamic parent sends and writes directly while exposing a compress operator', async () => {
  const parent = ctx.io.of(/^\/alias-/);
  const first = ctx.openClient({ namespace: '/alias-a' });
  const second = ctx.openClient({ namespace: '/alias-b' });
  await Promise.all([receive(first, 'connect'), receive(second, 'connect')]);
  const firstMessages = messages(first, 2);
  const secondMessages = messages(second, 2);

  expect(parent.send('parent-send')).toBe(parent);
  expect(parent.write('parent-write')).toBe(parent);
  const compressed = parent.compress(false);
  expect(compressed).not.toBe(parent);
  expect(compressed.compress(true)).not.toBe(compressed);

  await expect(firstMessages).resolves.toEqual(['parent-send', 'parent-write']);
  await expect(secondMessages).resolves.toEqual(['parent-send', 'parent-write']);
});

it('server and client Socket send aliases emit message once and return their socket', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const clientMessages = messages(client, 2);
  const serverMessages = messages(serverSocket, 1);
  const serverOutgoing: string[] = [];
  const clientOutgoing: string[] = [];
  serverSocket.onAnyOutgoing((event) => serverOutgoing.push(String(event)));
  client.onAnyOutgoing((event) => clientOutgoing.push(String(event)));

  expect(serverSocket.send('server-send')).toBe(serverSocket);
  expect(serverSocket.write('server-write')).toBe(serverSocket);
  expect(client.send('client-send')).toBe(client);

  await expect(clientMessages).resolves.toEqual(['server-send', 'server-write']);
  await expect(serverMessages).resolves.toEqual(['client-send']);
  expect(serverOutgoing).toEqual(['message', 'message']);
  expect(clientOutgoing).toEqual(['message']);
});

it('a buffered client send observes outgoing before connect and named delivery', async () => {
  const order: string[] = [];
  const delivered = new Promise<void>((resolve) => {
    ctx.io.on('connection', (socket) => {
      socket.on('message', () => {
        order.push('server named');
        resolve();
      });
    });
  });
  const client = ctx.openClient();
  client.onAnyOutgoing((event) => {
    if (event === 'message') order.push('outgoing');
  });
  client.on('connect', () => order.push('connect'));

  expect(client.connected).toBe(false);
  expect(client.send('buffered')).toBe(client);
  await delivered;

  expect(order).toEqual(['outgoing', 'connect', 'server named']);
});

it('server Socket in aliases to while preserving sender exclusion', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  await first.serverSocket.join('room');
  await second.serverSocket.join('room');
  const received = receive(second.client, 'socket-in');
  const excluded = track(first.client, 'socket-in');
  const marker = receive(first.client, 'marker');

  const operator = first.serverSocket.in('room');
  expect(operator).not.toBe(first.serverSocket);
  operator.emit('socket-in', 'hello');
  first.serverSocket.emit('marker', 'done');

  await expect(received).resolves.toBe('hello');
  await marker;
  expect(excluded.received).toBe(false);
});

it('compress returns immutable broadcast operators and composes with narrowing', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  const third = await ctx.connectClient();
  await first.serverSocket.join('first');
  await second.serverSocket.join('second');
  const firstOutgoing: string[] = [];
  const secondOutgoing: string[] = [];
  const recordsCompressionEvent = (event: string): boolean =>
    event.startsWith('compressed-') || event.endsWith('-compress');
  first.serverSocket.onAnyOutgoing((event) => {
    const name = String(event);
    if (recordsCompressionEvent(name)) firstOutgoing.push(name);
  });
  second.serverSocket.onAnyOutgoing((event) => {
    const name = String(event);
    if (recordsCompressionEvent(name)) secondOutgoing.push(name);
  });

  const serverOperator = ctx.io.compress(false);
  const namespace = ctx.io.of('/');
  const namespaceOperator = namespace.compress(false);
  expect(serverOperator).not.toBe(ctx.io);
  expect(namespaceOperator).not.toBe(namespace);

  const serverFirst = receive(first.client, 'server-compress');
  const serverSecond = track(second.client, 'server-compress');
  serverOperator.to('first').emit('server-compress', 'server');

  const namespaceSecond = receive(second.client, 'namespace-compress');
  const namespaceFirst = track(first.client, 'namespace-compress');
  namespaceOperator.to('second').emit('namespace-compress', 'namespace');

  const base = ctx.io.to('first');
  const compressed = base.compress(false);
  const widened = compressed.to('second').compress(true);
  expect(compressed).not.toBe(base);
  expect(widened).not.toBe(compressed);

  const firstDirect = receive(first.client, 'compressed-first');
  const secondDirect = track(second.client, 'compressed-first');
  compressed.emit('compressed-first', 'one');

  const firstWide = receive(first.client, 'compressed-wide');
  const secondWide = receive(second.client, 'compressed-wide');
  const thirdWide = track(third.client, 'compressed-wide');
  widened.emit('compressed-wide', 'two');

  const secondMarker = receive(second.client, 'second-marker');
  const thirdMarker = receive(third.client, 'third-marker');
  const firstMarker = receive(first.client, 'first-marker');
  first.serverSocket.emit('first-marker', 'done');
  second.serverSocket.emit('second-marker', 'done');
  third.serverSocket.emit('third-marker', 'done');

  await expect(serverFirst).resolves.toBe('server');
  await expect(namespaceSecond).resolves.toBe('namespace');
  await expect(firstDirect).resolves.toBe('one');
  await expect(firstWide).resolves.toBe('two');
  await expect(secondWide).resolves.toBe('two');
  await firstMarker;
  await secondMarker;
  await thirdMarker;
  expect(serverSecond.received).toBe(false);
  expect(namespaceFirst.received).toBe(false);
  expect(secondDirect.received).toBe(false);
  expect(thirdWide.received).toBe(false);
  expect(firstOutgoing).toEqual(['server-compress', 'compressed-first', 'compressed-wide']);
  expect(secondOutgoing).toEqual(['namespace-compress', 'compressed-wide']);
});

it('broadcast compress preserves a pending acknowledgement timeout', async () => {
  const { client } = await ctx.connectClient();
  client.on('question', (value, ack) => ack(String(value).length));

  const result = new Promise<{ error: unknown; answers: unknown[] }>((resolve) => {
    ctx.io
      .timeout(100)
      .compress(false)
      .emit('question', 'hello', (error: unknown, answers: unknown[]) =>
        resolve({ error, answers }),
      );
  });

  await expect(result).resolves.toEqual({ error: null, answers: [5] });
});

it('Socket compress stays fluent through timeout and volatile decorations', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const clientMessage = receive(client, 'message');
  const serverMessage = messages(serverSocket, 1);

  expect(serverSocket.timeout(100).compress(false)).toBe(serverSocket);
  expect(serverSocket.volatile.compress(true).send('server-compressed')).toBe(serverSocket);
  expect(client.timeout(100).compress(false)).toBe(client);
  expect(client.volatile.compress(true).send('client-compressed')).toBe(client);

  await expect(clientMessage).resolves.toBe('server-compressed');
  await expect(serverMessage).resolves.toEqual(['client-compressed']);
});

it('client open and close delegate to the lifecycle and keep fluent identity', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  expect(client.open()).toBe(client);

  const { disconnected } = observeDisconnect(serverSocket);
  expect(client.close()).toBe(client);
  await disconnected;

  const reconnected = ctx.nextConnection();
  const clientConnected = receive(client, 'connect');
  expect(client.open()).toBe(client);
  await Promise.all([reconnected, clientConnected]);
});
