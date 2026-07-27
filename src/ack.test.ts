import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

// Ack semantics pinned against real socket.io first, then satisfied by smocket.
// The exact shapes here (first-value resolve, ack-once, stays-pending, no
// server-side timeout requirement) were read off the real target, not guessed.
const ctx = setupServer();

it('다중 인자 ack은 첫 번째 값으로 resolve된다', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('multi', (ack: (...a: number[]) => void) => ack(1, 2, 3));
  await expect(client.emitWithAck('multi')).resolves.toBe(1);
});

it('trailing 콜백으로 sender-side ack을 받는다', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('cb', (a: number, ack: (n: number) => void) => ack(a * 10));
  const result = await new Promise((resolve) => {
    client.emit('cb', 5, (n: number) => resolve(n));
  });
  expect(result).toBe(50);
});

it('ack을 두 번 불러도 sender 콜백은 한 번만 실행된다', async () => {
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

it('상대가 ack을 안 부르면 emitWithAck은 pending으로 남는다', async () => {
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

it('서버 -> 클라이언트 emitWithAck은 timeout 없이 동작한다', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('sq', (n: number, ack: (r: number) => void) => ack(n + 1));
  await expect(serverSocket.emitWithAck('sq', 41)).resolves.toBe(42);
});
