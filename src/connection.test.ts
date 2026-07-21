import { expect, it } from 'vitest';
import { setupRealServer } from './setup-real-server';

const ctx = setupRealServer();

it('연결되면 양쪽 다 socket id를 가진다', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  expect(client.connected).toBe(true);
  expect(client.id).toBeTruthy();
  expect(serverSocket.id).toBe(client.id);
});

it('클라이언트 -> 서버 emit이 도착한다', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const received = new Promise<string>((resolve) => {
    serverSocket.on('ping', resolve);
  });
  client.emit('ping', 'hello');
  await expect(received).resolves.toBe('hello');
});

it('클라이언트 -> 서버 ack이 돌아온다', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('sum', (a: number, b: number, ack: (n: number) => void) => {
    ack(a + b);
  });
  const result = await client.emitWithAck('sum', 1, 2);
  expect(result).toBe(3);
});

it('서버 -> 클라이언트 ack이 돌아온다', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('sum', (a: number, b: number, ack: (n: number) => void) => {
    ack(a + b);
  });
  const result = await serverSocket.emitWithAck('sum', 1, 2);
  expect(result).toBe(3);
});
