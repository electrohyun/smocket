import { expect, it } from 'vitest';
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
  const io = new Server('http://ack-reconnect-flush');
  const client = io.connect();
  const serverSocket = await io.nextConnection();
  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  client.onAnyOutgoing((event) => {
    if (event === 'disconnect-during-flush') client.disconnect();
  });
  client.emit('disconnect-during-flush');
  const pending = client.timeout(60_000).emitWithAck('settled-during-flush');

  const nextServerSocket = io.nextConnection();
  client.connect();
  const socket = await nextServerSocket;
  const delivered = track(socket, 'settled-during-flush');
  const secondDisconnect = observeDisconnect(socket).disconnected;
  await expect(pending).rejects.toThrow('socket has been disconnected');
  await secondDisconnect;

  const connected = receive(client, 'connect');
  const reconnectedServerSocket = io.nextConnection();
  client.connect();
  const reconnected = await reconnectedServerSocket;
  reconnected.on('ack-marker', (ack: () => void) => ack());
  await connected;
  await client.emitWithAck('ack-marker');

  expect(delivered.received).toBe(false);
  await io.close();
});
