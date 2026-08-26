import { expect, it, vi } from 'vitest';
import { setupServer } from './setup-server';
import { observeDisconnect, receive, track } from './test-events';

const ctx = setupServer();

async function expectInactiveServerSocketToDropDirectSends(
  boundary: 'client disconnect' | 'server disconnect',
): Promise<void> {
  const { client, serverSocket: oldSocket } = await ctx.connectClient();
  const received = {
    event: false,
    message: false,
    callbackRequest: false,
    promiseRequest: false,
    timedCallbackRequest: false,
    timedPromiseRequest: false,
  };
  client.on('stale-event', () => (received.event = true));
  client.on('message', () => (received.message = true));
  client.on('stale-callback', (ack: (value: string) => void) => {
    received.callbackRequest = true;
    ack('answered');
  });
  client.on('stale-promise', (ack: (value: string) => void) => {
    received.promiseRequest = true;
    ack('answered');
  });
  client.on('stale-timed-callback', (ack: (value: string) => void) => {
    received.timedCallbackRequest = true;
    ack('answered');
  });
  client.on('stale-timed-promise', (ack: (value: string) => void) => {
    received.timedPromiseRequest = true;
    ack('answered');
  });

  if (boundary === 'client disconnect') {
    const { disconnected } = observeDisconnect(oldSocket);
    client.disconnect();
    await disconnected;
  } else {
    const disconnected = receive(client, 'disconnect');
    oldSocket.disconnect();
    await disconnected;
  }

  oldSocket.emit('stale-event', 'ignored');
  oldSocket.send('ignored');
  oldSocket.write('ignored');
  let callbackCalled = false;
  oldSocket.emit('stale-callback', () => {
    callbackCalled = true;
  });
  let promiseSettled = false;
  void oldSocket.emitWithAck('stale-promise').then(
    () => (promiseSettled = true),
    () => (promiseSettled = true),
  );
  const timedCallback = new Promise<unknown[]>((resolve) => {
    oldSocket.timeout(0).emit('stale-timed-callback', (...args: unknown[]) => resolve(args));
  });
  const timedPromise = oldSocket
    .timeout(0)
    .emitWithAck('stale-timed-promise')
    .then(
      (value) => ({ status: 'resolved' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );

  const nextConnection = ctx.nextConnection();
  const reconnected = receive(client, 'connect');
  client.connect();
  const currentSocket = await nextConnection;
  await reconnected;

  const marker = receive(client, 'fresh-marker');
  currentSocket.emit('fresh-marker', 'done');
  await marker;

  expect(received).toEqual({
    event: false,
    message: false,
    callbackRequest: false,
    promiseRequest: false,
    timedCallbackRequest: false,
    timedPromiseRequest: false,
  });
  expect(callbackCalled).toBe(false);
  expect(promiseSettled).toBe(false);
  await expect(timedCallback).resolves.toEqual([expect.any(Error)]);
  await expect(timedPromise).resolves.toMatchObject({
    status: 'rejected',
    error: { message: 'operation has timed out' },
  });

  const freshEvent = receive(client, 'fresh-event');
  currentSocket.emit('fresh-event', 'delivered');
  await expect(freshEvent).resolves.toBe('delivered');
  client.on('fresh-ack', (ack: (value: string) => void) => ack('fresh'));
  await expect(currentSocket.emitWithAck('fresh-ack')).resolves.toBe('fresh');
}

it('drops direct sends from the old server Socket after a client disconnect', async () => {
  await expectInactiveServerSocketToDropDirectSends('client disconnect');
});

it('drops direct sends from the old server Socket after a server disconnect', async () => {
  await expectInactiveServerSocketToDropDirectSends('server disconnect');
});

it('a disconnected socket no longer receives emits for that room', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');

  const msg1 = track(client1, 'msg');
  const got2 = receive(client2, 'msg');

  const { disconnected } = observeDisconnect(socket1);
  client1.disconnect();
  await disconnected;

  ctx.io.to('room').emit('msg', 'hello');

  // A disconnected client cannot receive a marker, so the still-connected
  // member of the room is the reference point instead: once the message has
  // landed there, the emit has been delivered to whoever was going to get it.
  await expect(got2).resolves.toBe('hello');
  expect(msg1.received).toBe(false);
});

it('client connected and disconnected remain exact inverses across teardown', async () => {
  const client = ctx.openClient();
  expect(client.connected).toBe(false);
  expect(client.disconnected).toBe(true);

  await receive(client, 'connect');
  expect(client.connected).toBe(true);
  expect(client.disconnected).toBe(false);

  const disconnected = receive(client, 'disconnect');
  client.disconnect();
  await disconnected;
  expect(client.connected).toBe(false);
  expect(client.disconnected).toBe(true);
});

it('a room disappears from the adapter when its last member disconnects', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  const socket1Id = socket1.id;

  // Reaching into the adapter is the only way to see a room that no longer
  // exists, since absence cannot be shown by delivery. This is internal state,
  // read here for observation only.
  const adapter = ctx.io.of('/').adapter;
  expect(adapter.rooms.has('room')).toBe(true);

  const { disconnected } = observeDisconnect(socket1);
  client1.disconnect();
  await disconnected;

  expect(adapter.rooms.has('room')).toBe(false);
  // Every socket also sits in a room named after its own id, and those are in
  // the same map, so the disconnect empties this socket's entries while the
  // other client keeps its own. Expecting rooms.size to reach 0 would fail.
  expect(adapter.rooms.has(socket1Id)).toBe(false);
  expect(adapter.rooms.has(socket2.id)).toBe(true);
});

it('whole-socket cleanup removes the sid from adapter membership', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  await serverSocket.join('room');
  const adapter = ctx.io.of('/').adapter;
  const sids = (adapter as typeof adapter & { sids: Map<string, Set<string>> }).sids;
  const sid = serverSocket.id;

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  expect(sids.has(sid)).toBe(false);
});

it('a disconnected socket cannot join rooms again', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  await serverSocket.join('before-disconnect');
  const adapter = ctx.io.of('/').adapter;
  const sids = (adapter as typeof adapter & { sids: Map<string, Set<string>> }).sids;
  const sid = serverSocket.id;

  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();
  await disconnected;

  expect(serverSocket.join('late-single')).toBeUndefined();
  expect(serverSocket.join(['late-a', 'late-b'])).toBeUndefined();
  expect(serverSocket.rooms.size).toBe(0);
  expect(sids.has(sid)).toBe(false);
  expect(adapter.rooms.has('late-single')).toBe(false);
  expect(adapter.rooms.has('late-a')).toBe(false);
  expect(adapter.rooms.has('late-b')).toBe(false);
});

it('a reconnected socket does not automatically rejoin its previous rooms', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join('room');
  await socket2.join('room');

  const { disconnected } = observeDisconnect(socket1);
  client1.disconnect();
  await disconnected;

  const reconnected = ctx.nextConnection();
  client1.connect();
  const socket1Again = await reconnected;

  // Same client, new socket and new id: the room membership did not come back.
  expect(socket1Again.id).not.toBe(socket1.id);
  expect(socket1Again.rooms.has('room')).toBe(false);

  const msg1 = track(client1, 'msg');
  const got2 = receive(client2, 'msg');

  ctx.io.to('room').emit('msg', 'hello');

  await expect(got2).resolves.toBe('hello');
  expect(msg1.received).toBe(false);
});

it('rooms are still present at disconnecting and empty at disconnect', async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join('room');
  const socket1Id = socket1.id;

  const { disconnecting, disconnected } = observeDisconnect(socket1);
  client1.disconnect();

  // This ordering is what makes "tell the room someone left" possible: the
  // rooms to notify are still readable at `disconnecting` and gone by
  // `disconnect`, so which event the work hangs off decides what it can see.
  const atDisconnecting = await disconnecting;
  expect(atDisconnecting.has('room')).toBe(true);
  expect(atDisconnecting.has(socket1Id)).toBe(true);

  const atDisconnect = await disconnected;
  expect(atDisconnect.size).toBe(0);
});

// In-flight ack semantics at disconnect, pinned against real socket.io: the
// three forms settle differently. The promise form on the client rejects; the
// trailing-callback form and the server-to-client promise both stay pending.

it('a pending client.emitWithAck rejects when the connection drops', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('slow', () => {
    /* never acks */
  });

  const pending = client.emitWithAck('slow');
  client.disconnect();

  await expect(pending).rejects.toThrow(/disconnected/);
});

it('disconnect clears a pending client timeout before rejecting emitWithAck', async () => {
  vi.useFakeTimers();
  try {
    const { client, serverSocket } = await ctx.connectClient();
    serverSocket.on('slow', () => {
      /* never acks */
    });
    const timersBeforeEmit = vi.getTimerCount();
    const pending = client.timeout(1000).emitWithAck('slow');
    const outcome = pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(vi.getTimerCount()).toBe(timersBeforeEmit + 1);

    client.disconnect();

    await expect(outcome).resolves.toMatchObject({
      message: expect.stringMatching(/disconnected/),
    });
    expect(vi.getTimerCount()).toBe(timersBeforeEmit);
  } finally {
    vi.useRealTimers();
  }
});

it('a disconnect from an outgoing observer clears the current emitWithAck timeout', async () => {
  vi.useFakeTimers();
  try {
    const { client, serverSocket } = await ctx.connectClient();
    serverSocket.on('slow', () => {
      /* never acks */
    });
    client.onAnyOutgoing(() => client.disconnect());
    const timersBeforeEmit = vi.getTimerCount();

    const outcome = client
      .timeout(60_000)
      .emitWithAck('slow')
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    await expect(outcome).resolves.toMatchObject({
      message: expect.stringMatching(/disconnected/),
    });
    expect(vi.getTimerCount()).toBe(timersBeforeEmit);
  } finally {
    vi.useRealTimers();
  }
});

it('client disconnect settles a sent timed callback once and clears its timer', async () => {
  vi.useFakeTimers();
  try {
    const { client, serverSocket } = await ctx.connectClient();
    serverSocket.on('slow', () => {
      /* retains no acknowledgement */
    });
    const timersBeforeEmit = vi.getTimerCount();
    const calls: unknown[][] = [];
    client.timeout(60_000).emit('slow', (...args: unknown[]) => calls.push(args));
    expect(vi.getTimerCount()).toBe(timersBeforeEmit + 1);

    const { disconnected } = observeDisconnect(serverSocket);
    client.disconnect();
    await disconnected;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({ message: 'socket has been disconnected' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('server Socket disconnect settles a sent client timed callback once', async () => {
  vi.useFakeTimers();
  try {
    const { client, serverSocket } = await ctx.connectClient();
    serverSocket.on('slow', () => {
      /* retains no acknowledgement */
    });
    const timersBeforeEmit = vi.getTimerCount();
    const calls: unknown[][] = [];
    client.timeout(60_000).emit('slow', (...args: unknown[]) => calls.push(args));
    expect(vi.getTimerCount()).toBe(timersBeforeEmit + 1);

    const clientDisconnected = receive(client, 'disconnect');
    serverSocket.disconnect();
    await clientDisconnected;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({ message: 'socket has been disconnected' });
    expect(vi.getTimerCount()).toBe(timersBeforeEmit);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('an outgoing observer disconnect settles the timed callback being sent', async () => {
  vi.useFakeTimers();
  try {
    const { client, serverSocket } = await ctx.connectClient();
    serverSocket.on('slow', () => {
      /* retains no acknowledgement */
    });
    client.onAnyOutgoing(() => client.disconnect());
    const timersBeforeEmit = vi.getTimerCount();
    const calls: unknown[][] = [];
    const { disconnected } = observeDisconnect(serverSocket);

    client.timeout(60_000).emit('slow', (...args: unknown[]) => calls.push(args));
    expect(vi.getTimerCount()).toBe(timersBeforeEmit);
    await disconnected;

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({ message: 'socket has been disconnected' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it('a trailing-callback ack is silently discarded when the connection drops', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('slow', () => {
    /* never acks */
  });

  const state = { called: false };
  client.emit('slow', () => {
    state.called = true;
  });
  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();

  // Unlike the promise form, the callback is never invoked, not even with an
  // error argument. The completed server-side lifecycle is the causal boundary.
  await disconnected;
  expect(state.called).toBe(false);
});

it('a pending server.emitWithAck stays pending when the client disconnects', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('slow', () => {
    /* never acks */
  });

  let settled = false;
  void serverSocket.emitWithAck('slow').then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const { disconnected } = observeDisconnect(serverSocket);
  client.disconnect();

  // The server side does not reject on the peer leaving; once teardown has
  // completed, it is still waiting for an acknowledgement that cannot arrive.
  await disconnected;
  expect(settled).toBe(false);
});

// disconnect reasons, pinned against real socket.io: a client-initiated close and
// a server-initiated one carry different strings, and each side sees its own.
it('client.disconnect() reports io client disconnect to the client and client namespace disconnect to the server', async () => {
  const { client, serverSocket } = await ctx.connectClient();

  const clientReason = new Promise<string>((resolve) =>
    client.once('disconnect', (reason: string) => resolve(reason)),
  );
  const serverReason = new Promise<string>((resolve) =>
    serverSocket.once('disconnect', (reason: string) => resolve(reason)),
  );

  client.disconnect();

  await expect(clientReason).resolves.toBe('io client disconnect');
  await expect(serverReason).resolves.toBe('client namespace disconnect');
});

it('serverSocket.disconnect() reports io server disconnect to the client and server namespace disconnect to the server', async () => {
  const { client, serverSocket } = await ctx.connectClient();

  const clientReason = new Promise<string>((resolve) =>
    client.once('disconnect', (reason: string) => resolve(reason)),
  );
  const serverReason = new Promise<string>((resolve) =>
    serverSocket.once('disconnect', (reason: string) => resolve(reason)),
  );

  serverSocket.disconnect();

  await expect(clientReason).resolves.toBe('io server disconnect');
  await expect(serverReason).resolves.toBe('server namespace disconnect');
});

it('disconnecting carries the same reason and fires before disconnect', async () => {
  const { client, serverSocket } = await ctx.connectClient();

  const order: string[] = [];
  serverSocket.once('disconnecting', (reason: string) => order.push(`disconnecting:${reason}`));
  const disconnected = new Promise<void>((resolve) =>
    serverSocket.once('disconnect', (reason: string) => {
      order.push(`disconnect:${reason}`);
      resolve();
    }),
  );

  client.disconnect();
  await disconnected;

  expect(order).toEqual([
    'disconnecting:client namespace disconnect',
    'disconnect:client namespace disconnect',
  ]);
});
