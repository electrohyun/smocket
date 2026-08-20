import { expect, it, vi } from 'vitest';
import { Server } from './mock-server';
import { count, observeDisconnect, receive, track } from './test-events';

it('discards an ack retained after an outgoing observer disconnects the client', async () => {
  const io = new Server('http://ack-outgoing-disconnect');
  const client = io.connect();
  const serverSocket = await io.nextConnection();
  const senderAnswers = count(client, 'sender-answer');
  const retained = new Promise<(value: string) => void>((resolve) => {
    client.on('held', (ack: (value: string) => void) => resolve(ack));
  });
  serverSocket.onAnyOutgoing((event) => {
    if (event === 'held') client.disconnect();
  });
  const { disconnected } = observeDisconnect(serverSocket);

  serverSocket.emit('held', () => {
    serverSocket.emit('sender-answer');
  });
  const answer = await retained;
  await disconnected;
  answer('late');

  const connected = receive(client, 'connect');
  const nextServerSocket = io.nextConnection();
  client.connect();
  const reconnected = await nextServerSocket;
  reconnected.on('ack-marker', (ack: () => void) => ack());
  await connected;
  await client.emitWithAck('ack-marker');

  expect(senderAnswers.count).toBe(0);
  await io.close();
});

it('skips a buffered timed promise settled during reconnect flush', async () => {
  vi.useFakeTimers();
  try {
    const io = new Server('http://ack-reconnect-flush');
    const client = io.connect();
    const serverSocket = await io.nextConnection();
    const { disconnected } = observeDisconnect(serverSocket);
    client.disconnect();
    await disconnected;

    client.onAnyOutgoing((event) => {
      if (event === 'advance-time-during-flush') vi.advanceTimersByTime(20);
    });
    client.emit('advance-time-during-flush');
    const pending = client.timeout(20).emitWithAck('settled-during-flush');

    const connected = receive(client, 'connect');
    const nextServerSocket = io.nextConnection();
    client.connect();
    const socket = await nextServerSocket;
    const delivered = track(socket, 'settled-during-flush');
    socket.on('ack-marker', (ack: () => void) => ack());
    await connected;
    await expect(pending).rejects.toThrow('operation has timed out');
    await client.emitWithAck('ack-marker');

    expect(delivered.received).toBe(false);
    await io.close();
  } finally {
    vi.useRealTimers();
  }
});

it('stops reconnect flushing when an outgoing observer disconnects', async () => {
  const io = new Server('http://ack-reconnect-flush-stop');
  const client = io.connect();
  const serverSocket = await io.nextConnection();
  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  let interrupted = false;
  let laterObserved = false;
  client.onAnyOutgoing((event) => {
    if (event === 'interrupt-flush' && !interrupted) {
      interrupted = true;
      client.disconnect();
    }
    if (event === 'after-interruption') laterObserved = true;
  });
  client.emit('interrupt-flush');
  const response = new Promise<unknown[]>((resolve) => {
    client.timeout(60_000).emit('after-interruption', (...args: unknown[]) => {
      client.emit('callback-settled');
      resolve(args);
    });
  });

  const interruptedConnection = receive(client, 'disconnect');
  const firstReconnection = io.nextConnection();
  client.connect();
  await firstReconnection;
  await interruptedConnection;
  expect(laterObserved).toBe(false);

  const connected = receive(client, 'connect');
  const secondReconnection = io.nextConnection();
  client.connect();
  const reconnected = await secondReconnection;
  const deliveryOrder: string[] = [];
  const callbackSettlements = count(reconnected, 'callback-settled');
  reconnected.on('interrupt-flush', () => deliveryOrder.push('interrupt-flush'));
  reconnected.on('after-interruption', (ack: (value: string) => void) => {
    deliveryOrder.push('after-interruption');
    ack('answer');
  });
  reconnected.on('ack-marker', (ack: () => void) => ack());
  await connected;
  await expect(response).resolves.toEqual([null, 'answer']);
  await client.emitWithAck('ack-marker');

  expect(callbackSettlements.count).toBe(1);
  expect(deliveryOrder).toEqual(['interrupt-flush', 'after-interruption']);
  expect(laterObserved).toBe(true);
  await io.close();
});
