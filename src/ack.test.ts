import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { observeDisconnect, receive } from './test-events';

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
    serverSocket.emit('marker');
  });
  let calls = 0;
  const marker = receive(client, 'marker');
  client.emit('double', () => {
    calls += 1;
  });
  await marker;
  expect(calls).toBe(1);
});

it('emitWithAck stays pending when the peer never acks', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('silent', () => {
    serverSocket.emit('marker');
  });
  let settled = false;
  const marker = receive(client, 'marker');
  void client.emitWithAck('silent').then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await marker;
  expect(settled).toBe(false);
});

it('server-to-client emitWithAck works without a timeout', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('sq', (n: number, ack: (r: number) => void) => ack(n + 1));
  await expect(serverSocket.emitWithAck('sq', 41)).resolves.toBe(42);
});

it('emitWithAck buffers while disconnected and settles after reconnect', async () => {
  const { client, serverSocket } = await ctx.connectClient();

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  // Buffered while disconnected, exactly like emit: it must wait for reconnect
  // rather than deliver to the dead socket, and it must neither throw nor leak.
  const pending = client.emitWithAck('q', 5);

  const reconnected = ctx.nextConnection();
  client.connect();
  const socket2 = await reconnected;
  socket2.on('q', (n: number, ack: (r: number) => void) => ack(n * 2));

  await expect(pending).resolves.toBe(10);
});
