import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

// `socket.timeout(ms)` semantics pinned against real socket.io first, then satisfied
// by smocket. The exact shapes here (error-first `(null, response)` on success, a lone
// `Error('operation has timed out')` on expiry, a dropped late ack, and identical
// behaviour in both directions) were read off the real target, not guessed. The happy
// paths use a generous timeout so the ack always wins; the timeout paths use a short one
// and a receiver that never acks, so the real timer is what settles them.
const ctx = setupServer();

it('the timeout callback receives (null, response) when the ack wins', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('echo', (n: number, ack: (r: number) => void) => ack(n * 2));
  const received = await new Promise<unknown[]>((resolve) => {
    client.timeout(1000).emit('echo', 21, (...args: unknown[]) => resolve(args));
  });
  expect(received).toEqual([null, 42]);
});

it('works server-to-client with the same success shape', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('sq', (n: number, ack: (r: number) => void) => ack(n + 1));
  const received = await new Promise<unknown[]>((resolve) => {
    serverSocket.timeout(1000).emit('sq', 41, (...args: unknown[]) => resolve(args));
  });
  expect(received).toEqual([null, 42]);
});

it('the callback gets a single timeout Error when the peer never acks', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('silent', () => {
    /* never acks */
  });
  const received = await new Promise<unknown[]>((resolve) => {
    client.timeout(20).emit('silent', (...args: unknown[]) => resolve(args));
  });
  expect(received).toHaveLength(1);
  expect(received[0]).toBeInstanceOf(Error);
  expect((received[0] as Error).message).toBe('operation has timed out');
});

it('times out the same way server-to-client', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('silent', () => {
    /* never acks */
  });
  const received = await new Promise<unknown[]>((resolve) => {
    serverSocket.timeout(20).emit('silent', (...args: unknown[]) => resolve(args));
  });
  expect(received).toHaveLength(1);
  expect(received[0]).toBeInstanceOf(Error);
  expect((received[0] as Error).message).toBe('operation has timed out');
});

it('drops a late ack that arrives after the timeout already fired', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  // Capture the ack rather than calling it, so the test controls when the peer answers.
  let lateAck: ((r: string) => void) | undefined;
  serverSocket.on('slow', (ack: (r: string) => void) => {
    lateAck = ack;
  });
  serverSocket.on('marker', (ack: () => void) => ack());

  let calls = 0;
  const first = await new Promise<unknown[]>((resolve) => {
    client.timeout(20).emit('slow', (...args: unknown[]) => {
      calls += 1;
      resolve(args);
    });
  });
  expect(first).toHaveLength(1);
  expect(first[0]).toBeInstanceOf(Error);
  expect(calls).toBe(1);

  // The peer answers now, after the timeout has fired: the late ack must be dropped.
  // A marker round-trip is sequenced after it (same socket, FIFO), so once the marker
  // resolves the late ack has been processed, and a second invocation would already
  // have happened. The count staying at one proves the callback fired exactly once.
  lateAck?.('late');
  await client.emitWithAck('marker');
  expect(calls).toBe(1);
});

it('timeout().emitWithAck resolves with the response when the ack wins', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('echo', (n: number, ack: (r: number) => void) => ack(n * 2));
  await expect(client.timeout(1000).emitWithAck('echo', 21)).resolves.toBe(42);
});

it('timeout().emitWithAck rejects with the timeout Error on expiry', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('silent', () => {
    /* never acks */
  });
  await expect(client.timeout(20).emitWithAck('silent')).rejects.toThrow('operation has timed out');
});

it('a callback-less timeout emit still delivers and arms no timer', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const delivered = new Promise<unknown>((resolve) => {
    serverSocket.on('plain', (payload: unknown) => resolve(payload));
  });
  client.timeout(20).emit('plain', 'hello');
  await expect(delivered).resolves.toBe('hello');
});
