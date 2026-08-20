import { expect, it } from 'vitest';
import type { ClientSocketContract, ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { observeDisconnect, receive } from './test-events';

// Ack semantics pinned against real socket.io first, then satisfied by smocket.
// The exact shapes here (first-value resolve, ack-once, stays-pending, no
// server-side timeout requirement) were read off the real target, not guessed.
const ctx = setupServer();

async function retainBidirectionalAcks(
  client: ClientSocketContract,
  serverSocket: ServerSocketContract,
): Promise<{
  answerOnClient: (value: string) => void;
  answerOnServer: (value: string) => void;
  senderCalls: { client: number; server: number };
}> {
  let answerOnClient!: (value: string) => void;
  let answerOnServer!: (value: string) => void;
  const senderCalls = { client: 0, server: 0 };
  const retainedOnClient = new Promise<void>((resolve) => {
    client.on('held-from-server', (_value: string, ack: (value: string) => void) => {
      answerOnClient = ack;
      resolve();
    });
  });
  const retainedOnServer = new Promise<void>((resolve) => {
    serverSocket.on('held-from-client', (_value: string, ack: (value: string) => void) => {
      answerOnServer = ack;
      resolve();
    });
  });

  client.emit('held-from-client', 'request', () => {
    senderCalls.client += 1;
  });
  serverSocket.emit('held-from-server', 'request', () => {
    senderCalls.server += 1;
  });
  await Promise.all([retainedOnClient, retainedOnServer]);
  return { answerOnClient, answerOnServer, senderCalls };
}

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

it('discards retained acks in both directions after the client disconnects', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const { answerOnClient, answerOnServer, senderCalls } = await retainBidirectionalAcks(
    client,
    serverSocket,
  );

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  answerOnClient('late');
  answerOnServer('late');
  await disconnected;

  const connected = receive(client, 'connect');
  const nextServerSocket = ctx.nextConnection();
  client.connect();
  const socket = await nextServerSocket;
  socket.on('ack-marker', (ack: () => void) => ack());
  await connected;
  answerOnClient('still late');
  answerOnServer('still late');
  await client.emitWithAck('ack-marker');

  expect(senderCalls).toEqual({ client: 0, server: 0 });
});

it('discards retained acks in both directions after the server Socket disconnects', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const { answerOnClient, answerOnServer, senderCalls } = await retainBidirectionalAcks(
    client,
    serverSocket,
  );

  const clientDisconnected = receive(client, 'disconnect');
  serverSocket.disconnect();
  answerOnClient('late');
  answerOnServer('late');
  await clientDisconnected;

  const connected = receive(client, 'connect');
  const nextServerSocket = ctx.nextConnection();
  client.connect();
  const socket = await nextServerSocket;
  socket.on('ack-marker', (ack: () => void) => ack());
  await connected;
  answerOnClient('still late');
  answerOnServer('still late');
  await client.emitWithAck('ack-marker');

  expect(senderCalls).toEqual({ client: 0, server: 0 });
});

it('discards retained acks in both directions during server close', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const { answerOnClient, answerOnServer, senderCalls } = await retainBidirectionalAcks(
    client,
    serverSocket,
  );

  client.once('disconnect', () => {
    answerOnClient('late');
    answerOnServer('late');
  });
  await ctx.io.close();

  // close completion is later than the client disconnect handler that invokes the held ack.
  expect(senderCalls).toEqual({ client: 0, server: 0 });
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
