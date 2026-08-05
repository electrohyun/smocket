import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

// The broadcast form of `timeout` collects an ack from every recipient and invokes one
// callback: `(null, responses)` when all answer in time, `(Error, responses)` when the
// timer wins, with `responses` holding whatever arrived. All shapes here were measured
// against real socket.io 4.8.3 first, then satisfied by smocket. A silent recipient (one
// that never acks) is how the timeout branch is reached; the marker for "collected the
// rest" is the callback itself firing, so no bare-timeout non-receipt assertion is needed.
const ctx = setupServer();

it('collects every recipient ack and answers (null, responses)', async () => {
  const clients = await ctx.connectClients(3);
  await Promise.all(clients.map(({ serverSocket }) => serverSocket.join('room')));
  clients.forEach(({ client }, i) =>
    client.on('ask', (_q: unknown, ack: (r: string) => void) => ack(`r${i}`)),
  );
  const { err, responses } = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) =>
    ctx.io
      .timeout(200)
      .to('room')
      .emit('ask', 'q', (e: unknown, r: unknown[]) => resolve({ err: e, responses: r })),
  );
  expect(err).toBeNull();
  expect(Array.isArray(responses)).toBe(true);
  // Order is ack-arrival order on real socket.io; assert membership, which is stable.
  expect([...responses].sort()).toEqual(['r0', 'r1', 'r2']);
});

it('orders responses by ack arrival, not by join order', async () => {
  // `first` joins the room first but acks late; `second` joins after but acks early.
  // A wide gap between the two delays makes the arrival order deterministic on both
  // targets, so the array must come back in ack-arrival order, not join order (4.8.3).
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  await first.serverSocket.join('room');
  await second.serverSocket.join('room');
  first.client.on('ask', (_q: unknown, ack: (r: string) => void) =>
    setTimeout(() => ack('late'), 60),
  );
  second.client.on('ask', (_q: unknown, ack: (r: string) => void) =>
    setTimeout(() => ack('early'), 10),
  );
  const { err, responses } = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) =>
    ctx.io
      .timeout(300)
      .to('room')
      .emit('ask', 'q', (e: unknown, r: unknown[]) => resolve({ err: e, responses: r })),
  );
  expect(err).toBeNull();
  expect(responses).toEqual(['early', 'late']); // arrival order (10ms before 60ms), not join order
});

it('answers (Error, partial responses) when a recipient never acks in time', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  await first.serverSocket.join('room');
  await second.serverSocket.join('room');
  first.client.on('ask', (_q: unknown, ack: (r: string) => void) => ack('answered'));
  second.client.on('ask', () => {
    /* never acks */
  });
  const { err, responses } = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) =>
    ctx.io
      .timeout(30)
      .to('room')
      .emit('ask', 'q', (e: unknown, r: unknown[]) => resolve({ err: e, responses: r })),
  );
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toBe('operation has timed out');
  expect(responses).toEqual(['answered']); // only the ack that arrived in time
});

it('invokes the callback exactly once, dropping an ack that arrives after expiry', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  await first.serverSocket.join('room');
  await second.serverSocket.join('room');
  first.client.on('ask', (_q: unknown, ack: (r: string) => void) => ack('fast'));
  // Capture the second recipient's ack so the test fires it late, after the timeout.
  let lateAck: ((r: string) => void) | undefined;
  second.client.on('ask', (_q: unknown, ack: (r: string) => void) => {
    lateAck = ack;
  });
  let calls = 0;
  await new Promise<void>((resolve) =>
    ctx.io
      .timeout(30)
      .to('room')
      .emit('ask', 'q', () => {
        calls += 1;
        resolve();
      }),
  );
  lateAck?.('too late'); // arrives after the timeout already answered
  // A marker round-trip through a fresh client proves the late ack had time to land.
  const marker = await ctx.connectClient();
  await new Promise<void>((resolve) => {
    marker.client.on('marker', () => resolve());
    marker.serverSocket.emit('marker');
  });
  expect(calls).toBe(1);
});

it('answers (null, []) at once for a broadcast to a room with no recipients', async () => {
  await ctx.connectClients(1); // a connected socket, but not in the target room
  const { err, responses } = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) =>
    ctx.io
      .timeout(1000)
      .to('nobody')
      .emit('ask', 'q', (e: unknown, r: unknown[]) => resolve({ err: e, responses: r })),
  );
  expect(err).toBeNull();
  expect(responses).toEqual([]); // resolves as success, does not wait out the timeout
});

it('socket.broadcast.timeout(ms) collects from everyone except the sender', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  const c = await ctx.connectClient();
  b.client.on('ask', (_q: unknown, ack: (r: string) => void) => ack('b'));
  c.client.on('ask', (_q: unknown, ack: (r: string) => void) => ack('c'));
  let senderGot = false;
  a.client.on('ask', () => {
    senderGot = true;
  });
  const { err, responses } = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) =>
    a.serverSocket.broadcast
      .timeout(200)
      .emit('ask', 'q', (e: unknown, r: unknown[]) => resolve({ err: e, responses: r })),
  );
  expect(err).toBeNull();
  expect([...responses].sort()).toEqual(['b', 'c']);
  expect(senderGot).toBe(false); // the sender is excluded from its own broadcast
});

it('a chained except drops that recipient from the collection, timeout set first', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  await a.serverSocket.join('room');
  await b.serverSocket.join('room');
  a.client.on('ask', (_q: unknown, ack: (r: string) => void) => ack('a'));
  let excludedGot = false;
  b.client.on('ask', () => {
    excludedGot = true;
  });
  const { err, responses } = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) =>
    ctx.io
      .timeout(200)
      .to('room')
      .except(b.serverSocket.id)
      .emit('ask', 'q', (e: unknown, r: unknown[]) => resolve({ err: e, responses: r })),
  );
  // A null error is itself the proof of the recipient set, not just of ordering: the
  // excluded socket never acks, so had it been a recipient the collection would still be
  // one ack short and could only answer with an Error once the timeout expired. The flag
  // below therefore needs no marker of its own; it is read after the callback has already
  // ruled the socket out.
  expect(err).toBeNull();
  expect(responses).toEqual(['a']);
  expect(excludedGot).toBe(false);
});

it('a chained except drops that recipient from the collection, timeout set last', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  await a.serverSocket.join('room');
  await b.serverSocket.join('room');
  a.client.on('ask', (_q: unknown, ack: (r: string) => void) => ack('a'));
  let excludedGot = false;
  b.client.on('ask', () => {
    excludedGot = true;
  });
  const { err, responses } = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) =>
    ctx.io
      .to('room')
      .except(b.serverSocket.id)
      .timeout(200)
      .emit('ask', 'q', (e: unknown, r: unknown[]) => resolve({ err: e, responses: r })),
  );
  expect(err).toBeNull(); // the same proof of the recipient set as the test above
  expect(responses).toEqual(['a']); // the order of timeout and except does not matter
  expect(excludedGot).toBe(false);
});

it('socket.timeout(ms).to(room) collects from the room, timeout set first', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  const c = await ctx.connectClient();
  await b.serverSocket.join('room');
  await c.serverSocket.join('room');
  b.client.on('ask', (_q: unknown, ack: (r: string) => void) => ack('b'));
  c.client.on('ask', (_q: unknown, ack: (r: string) => void) => ack('c'));
  const { err, responses } = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) =>
    a.serverSocket
      .timeout(200)
      .to('room')
      .emit('ask', 'q', (e: unknown, r: unknown[]) => resolve({ err: e, responses: r })),
  );
  expect(err).toBeNull();
  expect([...responses].sort()).toEqual(['b', 'c']);
});
