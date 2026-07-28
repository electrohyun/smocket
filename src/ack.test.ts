import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

// Ack semantics pinned against real socket.io first, then satisfied by smocket.
// The exact shapes here (first-value resolve, ack-once, stays-pending, no
// server-side timeout requirement) were read off the real target, not guessed.
const ctx = setupServer();

it('multi-argument ack resolves with the first value', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('multi', (ack: (...a: number[]) => void) => ack(1, 2, 3));
  await expect(client.emitWithAck('multi')).resolves.toBe(1);
});

it('the trailing callback receives the sender-side ack', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('cb', (a: number, ack: (n: number) => void) => ack(a * 10));
  const result = await new Promise((resolve) => {
    client.emit('cb', 5, (n: number) => resolve(n));
  });
  expect(result).toBe(50);
});

it('calling ack twice runs the sender callback only once', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('double', (ack: (n: number) => void) => {
    ack(1);
    ack(2);
  });
  let calls = 0;
  await new Promise<void>((resolve) => {
    client.emit('double', () => {
      calls += 1;
      setTimeout(resolve, 30);
    });
  });
  expect(calls).toBe(1);
});

it('emitWithAck stays pending when the peer never acks', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('silent', () => {
    /* never acks */
  });
  const race = await Promise.race([
    client.emitWithAck('silent').then(() => 'resolved'),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 30)),
  ]);
  expect(race).toBe('pending');
});

it('server-to-client emitWithAck works without a timeout', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('sq', (n: number, ack: (r: number) => void) => ack(n + 1));
  await expect(serverSocket.emitWithAck('sq', 41)).resolves.toBe(42);
});
