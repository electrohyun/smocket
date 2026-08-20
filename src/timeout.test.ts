import { expect, it, vi } from 'vitest';
import type { ServerSocketContract } from './contract';
import { setupServer } from './setup-server';
import { observeDisconnect, receive, track } from './test-events';

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
  let calls = 0;
  const received = await new Promise<unknown[]>((resolve) => {
    client.timeout(1000).emit('echo', 21, (...args: unknown[]) => {
      calls += 1;
      resolve(args);
    });
  });
  expect(received).toEqual([null, 42]);

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;
  expect(calls).toBe(1);
});

it('works server-to-client with the same success shape', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('sq', (n: number, ack: (r: number) => void) => ack(n + 1));
  const received = await new Promise<unknown[]>((resolve) => {
    serverSocket.timeout(1000).emit('sq', 41, (...args: unknown[]) => resolve(args));
  });
  expect(received).toEqual([null, 42]);
});

it('returns the same socket and consumes a direct timeout once, on both sides', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('client-q', (n: number, ack: (r: number) => void) => ack(n + 1));
  client.on('server-q', (n: number, ack: (r: number) => void) => ack(n + 1));

  const timedClient = client.timeout(1000);
  const timedServer = serverSocket.timeout(1000);
  expect(timedClient).toBe(client);
  expect(timedServer).toBe(serverSocket);

  const clientFirst = await new Promise<unknown[]>((resolve) => {
    timedClient.emit('client-q', 1, (...args: unknown[]) => resolve(args));
  });
  const clientSecond = await new Promise<unknown[]>((resolve) => {
    timedClient.emit('client-q', 2, (...args: unknown[]) => resolve(args));
  });
  const serverFirst = await new Promise<unknown[]>((resolve) => {
    timedServer.emit('server-q', 3, (...args: unknown[]) => resolve(args));
  });
  const serverSecond = await new Promise<unknown[]>((resolve) => {
    timedServer.emit('server-q', 4, (...args: unknown[]) => resolve(args));
  });

  expect(clientFirst).toEqual([null, 2]);
  expect(clientSecond).toEqual([3]);
  expect(serverFirst).toEqual([null, 4]);
  expect(serverSecond).toEqual([5]);
});

it('keeps a recipient timeout pending across plain and ack-collecting broadcasts', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('broadcast-ack', (ack: (value: string) => void) => ack('broadcast'));
  client.on('direct', (ack: (value: string) => void) => ack('direct'));

  expect(serverSocket.timeout(1000)).toBe(serverSocket);
  const plainBroadcast = new Promise<unknown>((resolve) => client.once('plain', resolve));
  ctx.io.emit('plain', 'delivered');
  await expect(plainBroadcast).resolves.toBe('delivered');

  await new Promise<void>((resolve) => {
    ctx.io.timeout(1000).emit('broadcast-ack', (error: unknown, responses: unknown[]) => {
      expect(error).toBeNull();
      expect(responses).toEqual(['broadcast']);
      resolve();
    });
  });

  const direct = await new Promise<unknown[]>((resolve) => {
    serverSocket.emit('direct', (...args: unknown[]) => resolve(args));
  });
  expect(direct).toEqual([null, 'direct']);
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

it('keeps a timed callback buffered until reconnect and settles it normally', async () => {
  vi.useFakeTimers();
  try {
    const { client, serverSocket } = await ctx.connectClient();
    const { disconnected } = observeDisconnect(serverSocket);
    client.disconnect();
    await disconnected;

    let calls = 0;
    const response = new Promise<unknown[]>((resolve) => {
      client.timeout(60_000).emit('buffered', (...args: unknown[]) => {
        calls += 1;
        resolve(args);
      });
    });

    const nextServerSocket = ctx.nextConnection();
    client.connect();
    const socket = await nextServerSocket;
    socket.on('buffered', (ack: (value: string) => void) => ack('answer'));

    await expect(response).resolves.toEqual([null, 'answer']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
  } finally {
    vi.useRealTimers();
  }
});

it('does not revive a timed callback that expired while buffered', async () => {
  vi.useFakeTimers();
  try {
    const { client, serverSocket } = await ctx.connectClient();
    const { disconnected } = observeDisconnect(serverSocket);
    client.disconnect();
    await disconnected;

    const calls: unknown[][] = [];
    client.timeout(20).emit('expired-buffer', (...args: unknown[]) => calls.push(args));
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({ message: 'operation has timed out' });

    const connected = receive(client, 'connect');
    const nextServerSocket = ctx.nextConnection();
    client.connect();
    const socket = await nextServerSocket;
    socket.on('expired-buffer', (ack: (value: string) => void) => ack('too late'));
    socket.on('ack-marker', (ack: () => void) => ack());
    await connected;
    await client.emitWithAck('ack-marker');

    expect(calls).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('server timeout().emitWithAck resolves and rejects with the same one-shot decoration', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('echo', (n: number, ack: (r: number) => void) => ack(n * 2));
  client.on('silent', () => {
    /* never acks */
  });

  await expect(serverSocket.timeout(1000).emitWithAck('echo', 21)).resolves.toBe(42);
  await expect(serverSocket.timeout(20).emitWithAck('silent')).rejects.toThrow(
    'operation has timed out',
  );
});

it('times out volatile server emits in either modifier order without delivering them', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  const callbackPacket = track(client, 'callback-packet');
  const promisePacket = track(client, 'promise-packet');
  const marker = receive(client, 'marker');
  let callbackOutcome!: Promise<unknown[]>;
  let promiseOutcome!: Promise<unknown>;

  ctx.io.on('connection', (socket: ServerSocketContract) => {
    vi.useFakeTimers();
    try {
      callbackOutcome = new Promise((resolve) => {
        socket.timeout(20).volatile.emit('callback-packet', (...args: unknown[]) => resolve(args));
      });
      promiseOutcome = socket.volatile
        .timeout(20)
        .emitWithAck('promise-packet')
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      socket.emit('marker', 'done');
      vi.advanceTimersByTime(20);
    } finally {
      vi.useRealTimers();
    }
  });
  client.connect();

  await expect(marker).resolves.toBe('done');
  expect(callbackPacket.received).toBe(false);
  expect(promisePacket.received).toBe(false);
  const callbackArgs = await callbackOutcome;
  expect(callbackArgs).toHaveLength(1);
  expect(callbackArgs[0]).toMatchObject({ message: 'operation has timed out' });
  await expect(promiseOutcome).resolves.toMatchObject({ message: 'operation has timed out' });
});

it('a callback-less timeout emit still delivers and arms no timer', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const delivered = new Promise<unknown>((resolve) => {
    serverSocket.on('plain', (payload: unknown) => resolve(payload));
  });
  client.timeout(20).emit('plain', 'hello');
  await expect(delivered).resolves.toBe('hello');
});
