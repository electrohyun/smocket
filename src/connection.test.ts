import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

const ctx = setupServer();

it('both sides have a socket id once connected', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  expect(client.connected).toBe(true);
  expect(client.id).toBeTruthy();
  expect(serverSocket.id).toBe(client.id);
});

it('a client-to-server emit arrives', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const received = new Promise<string>((resolve) => {
    serverSocket.on('ping', resolve);
  });
  client.emit('ping', 'hello');
  await expect(received).resolves.toBe('hello');
});

it('a client-to-server ack comes back', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('sum', (a: number, b: number, ack: (n: number) => void) => {
    ack(a + b);
  });
  const result = await client.emitWithAck('sum', 1, 2);
  expect(result).toBe(3);
});

it('a server-to-client ack comes back', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('sum', (a: number, b: number, ack: (n: number) => void) => {
    ack(a + b);
  });
  const result = await serverSocket.emitWithAck('sum', 1, 2);
  expect(result).toBe(3);
});
