import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { observeDisconnect } from './test-events';

const ctx = setupServer();

it('registers per-socket middleware in order and returns the same socket', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  expect(
    serverSocket.use((packet, next) => {
      order.push(`first:${packet[0]}`);
      next();
    }),
  ).toBe(serverSocket);
  serverSocket.use((packet, next) => {
    order.push(`second:${packet[0]}`);
    next();
  });
  const delivered = new Promise<void>((resolve) => {
    serverSocket.on('work', () => {
      order.push('named');
      resolve();
    });
  });

  client.emit('work');
  await delivered;
  expect(order).toEqual(['first:work', 'second:work', 'named']);
});

it('runs incoming catch-alls before middleware and exposes packet mutation downstream', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  serverSocket.onAny((event, value) => order.push(`any:${event}:${value}`));
  serverSocket.use((packet, next) => {
    order.push(`first:${packet[0]}:${packet[1]}`);
    packet[0] = 'renamed';
    packet[1] = 'changed';
    next();
  });
  serverSocket.use((packet, next) => {
    order.push(`second:${packet[0]}:${packet[1]}`);
    next();
  });
  const delivered = new Promise<void>((resolve) => {
    serverSocket.on('renamed', (value: string) => {
      order.push(`named:${value}`);
      resolve();
    });
  });

  client.emit('original', 'value');
  await delivered;
  expect(order).toEqual([
    'any:original:value',
    'first:original:value',
    'second:renamed:changed',
    'named:changed',
  ]);
});

it('keeps the acknowledgement callback in the mutable middleware packet', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.use((packet, next) => {
    expect(packet[0]).toBe('sum');
    expect(typeof packet.at(-1)).toBe('function');
    next();
  });
  serverSocket.on('sum', (a: number, b: number, ack: (value: number) => void) => ack(a + b));

  await expect(client.emitWithAck('sum', 2, 3)).resolves.toBe(5);
});

it('snapshots middleware when each packet begins processing', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const seen: string[] = [];
  let registered = false;
  serverSocket.use((_packet, next) => {
    if (!registered) {
      registered = true;
      serverSocket.use((laterPacket, laterNext) => {
        seen.push(`late:${laterPacket[0]}`);
        laterNext();
      });
    }
    next();
  });
  serverSocket.on('packet', (value: string, ack: () => void) => {
    seen.push(`named:${value}`);
    ack();
  });

  await client.emitWithAck('packet', 'first');
  expect(seen).toEqual(['named:first']);

  await client.emitWithAck('packet', 'second');
  expect(seen).toEqual(['named:first', 'late:packet', 'named:second']);
});

it('lets a later packet complete while earlier packet middleware is held', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const order: string[] = [];
  let release!: () => void;
  serverSocket.use((packet, next) => {
    order.push(`middleware:${packet[0]}`);
    if (packet[0] === 'held') release = next;
    else next();
  });
  serverSocket.on('held', (_value: string, ack: (value: string) => void) => {
    order.push('named:held');
    ack('held');
  });
  serverSocket.on('fast', (_value: string, ack: (value: string) => void) => {
    order.push('named:fast');
    ack('fast');
  });

  const held = client.emitWithAck('held', 'A').then((value) => order.push(`ack:${value}`));
  const fast = client.emitWithAck('fast', 'B').then((value) => order.push(`ack:${value}`));
  await fast;
  expect(order).toEqual(['middleware:held', 'middleware:fast', 'named:fast', 'ack:fast']);
  release();
  await held;
  expect(order).toEqual([
    'middleware:held',
    'middleware:fast',
    'named:fast',
    'ack:fast',
    'named:held',
    'ack:held',
  ]);
});

it('short-circuits on next(error), emits that Error, and does not acknowledge', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let rejected = false;
  serverSocket.on('restricted', () => {
    rejected = true;
  });
  let acknowledged = false;
  const laterMiddleware: string[] = [];
  const error = new Error('unauthorized event');
  serverSocket.use((packet, next) => next(packet[0] === 'restricted' ? error : undefined));
  serverSocket.use((packet, next) => {
    laterMiddleware.push(packet[0]);
    next();
  });
  const observedError = new Promise<Error>((resolve) => serverSocket.once('error', resolve));
  const marker = new Promise<string>((resolve) => serverSocket.once('marker', resolve));

  client.emit('restricted', () => {
    acknowledged = true;
  });
  client.emit('marker', 'done');

  await expect(observedError).resolves.toBe(error);
  await expect(marker).resolves.toBe('done');
  expect(rejected).toBe(false);
  expect(acknowledged).toBe(false);
  expect(laterMiddleware).toEqual(['marker']);
});

it('does not dispatch a held packet after the socket disconnects', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let held = false;
  serverSocket.on('held', () => {
    held = true;
  });
  let release!: () => void;
  serverSocket.use((_packet, next) => {
    release = next;
  });
  client.emit('held');
  await Promise.resolve();

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  const marker = new Promise<void>((resolve) => {
    release();
    queueMicrotask(resolve);
  });
  await marker;
  expect(held).toBe(false);
});
