import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ServerSocketContract } from './contract';
import { DelayingAdapter, Server } from './index';

// `DelayingAdapter` is a mock-only affordance (#78): it has no socket.io counterpart, so
// these tests use smocket's own Server directly rather than the dual-run `setupServer`,
// the same way the adapter-seam tests do. They drive time with Vitest's fake timers, so a
// delayed delivery is asserted deterministically and nothing waits on the wall clock. The
// default DeliveryTimer delegates to setTimeout / Date.now, which fake timers control;
// queueMicrotask is not faked, so the connect handshake still settles on its own.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function connect(io: Server) {
  const client = io.connect();
  const serverSocket = await io.nextConnection();
  return { client, serverSocket };
}

/**
 * Flush pending microtasks without advancing the fake clock. An undelayed delivery still
 * goes through the next-tick `defer` (a microtask), so this drives it; a delayed one is on
 * the timer and stays put, which is what tells the two paths apart.
 */
const flush = () => Promise.resolve();

it('an emit from a connection handler reaches the client, before the pairing completes', async () => {
  // Routing delivery through the socket's own scheduler must not assume the client is
  // already paired: a `connection` handler emitting to the socket runs before that, so the
  // scheduler falls back to the next tick rather than dereferencing an unset paired socket.
  const io = new Server('http://localhost');
  io.on('connection', (socket: ServerSocketContract) => socket.emit('welcome', 'hi'));
  const client = io.connect();
  const got = await new Promise<unknown>((resolve) => {
    client.on('welcome', (v: unknown) => resolve(v)); // registered before the deferred pairing
  });
  expect(got).toBe('hi');
});

it('a delayed socket is held on the timer while an undelayed one still arrives next tick', async () => {
  const io = new Server('http://localhost');
  let delaying!: DelayingAdapter;
  io.adapter(() => (delaying = new DelayingAdapter()));

  const a = await connect(io);
  const b = await connect(io);
  const seenA: string[] = [];
  const seenB: string[] = [];
  a.client.on('ev', (v: string) => seenA.push(v));
  b.client.on('ev', (v: string) => seenB.push(v));

  delaying.setDelay(a.serverSocket.id, 20); // hold socket A's stream by 20ms
  io.emit('ev', 'x'); // broadcast to both

  await flush(); // microtasks only, no clock advance
  expect(seenB).toEqual(['x']); // B kept the next-tick delivery
  expect(seenA).toEqual([]); // A is on the timer, not delivered by a microtask flush

  await vi.advanceTimersByTimeAsync(20);
  expect(seenA).toEqual(['x']); // A delivered after its delay
});

it('does not delay the server side: a client emit is received on the next tick', async () => {
  const io = new Server('http://localhost');
  let delaying!: DelayingAdapter;
  io.adapter(() => (delaying = new DelayingAdapter()));

  const { client, serverSocket } = await connect(io);
  const seen: string[] = [];
  serverSocket.on('up', (v: string) => seen.push(v));

  delaying.setDelay(serverSocket.id, 100); // delays what the CLIENT receives, not the server
  client.emit('up', 'q');

  await flush(); // no clock advance
  expect(seen).toEqual(['q']); // the server side is never held by the delay
});

it("preserves order within a delayed socket's stream, and holds it until the delay elapses", async () => {
  const io = new Server('http://localhost');
  let delaying!: DelayingAdapter;
  io.adapter(() => (delaying = new DelayingAdapter()));

  const { client, serverSocket } = await connect(io);
  const seen: string[] = [];
  client.on('ev', (v: string) => seen.push(v));

  delaying.setDelay(serverSocket.id, 10);
  serverSocket.emit('ev', '1');
  serverSocket.emit('ev', '2');
  serverSocket.emit('ev', '3');

  await flush();
  expect(seen).toEqual([]); // all three are held on the timer, not delivered next tick
  await vi.advanceTimersByTimeAsync(10);
  expect(seen).toEqual(['1', '2', '3']); // FIFO across the whole delayed stream
});

it('a lowered delay does not let a new event overtake one already queued', async () => {
  const io = new Server('http://localhost');
  let delaying!: DelayingAdapter;
  io.adapter(() => (delaying = new DelayingAdapter()));

  const { client, serverSocket } = await connect(io);
  const seen: string[] = [];
  client.on('ev', (v: string) => seen.push(v));

  delaying.setDelay(serverSocket.id, 50);
  serverSocket.emit('ev', 'first'); // scheduled 50ms out
  delaying.setDelay(serverSocket.id, 0); // lower the delay for subsequent emits
  serverSocket.emit('ev', 'second'); // must still wait behind 'first', not overtake it

  await vi.advanceTimersByTimeAsync(49);
  expect(seen).toEqual([]); // neither has fired yet

  await vi.advanceTimersByTimeAsync(1);
  expect(seen).toEqual(['first', 'second']); // both at 50ms, in send order
});

it('a new delay applies only to deliveries scheduled after it is set', async () => {
  const io = new Server('http://localhost');
  let delaying!: DelayingAdapter;
  io.adapter(() => (delaying = new DelayingAdapter()));

  const { client, serverSocket } = await connect(io);
  const seen: string[] = [];
  client.on('ev', (v: string) => seen.push(v));

  serverSocket.emit('ev', 'immediate'); // no delay set yet
  await vi.advanceTimersByTimeAsync(0);
  expect(seen).toEqual(['immediate']);

  delaying.setDelay(serverSocket.id, 30);
  serverSocket.emit('ev', 'delayed');
  await vi.advanceTimersByTimeAsync(0);
  expect(seen).toEqual(['immediate']); // the new delay holds it
  await vi.advanceTimersByTimeAsync(30);
  expect(seen).toEqual(['immediate', 'delayed']);
});

it('gates order through the queue, not the timer: only the head is ever scheduled', async () => {
  // A hand-driven timer (no fake-timer globals) lets the test see how many deliveries the
  // adapter has outstanding. The queue must schedule only the head, so a later emit with a
  // shorter delay cannot reach the timer, let alone fire, before the earlier one.
  vi.useRealTimers();
  let clock = 0;
  const pending: Array<{ fn: () => void; at: number }> = [];
  const timer = {
    now: () => clock,
    schedule: (fn: () => void, ms: number) => pending.push({ fn, at: clock + ms }),
  };

  const io = new Server('http://localhost');
  let delaying!: DelayingAdapter;
  io.adapter(() => (delaying = new DelayingAdapter(timer)));
  const { client, serverSocket } = await connect(io);
  const seen: string[] = [];
  client.on('ev', (v: string) => seen.push(v));

  delaying.setDelay(serverSocket.id, 100);
  serverSocket.emit('ev', 'slow'); // fireAt 100
  delaying.setDelay(serverSocket.id, 1);
  serverSocket.emit('ev', 'fast'); // fireAt 1, but queued behind 'slow'
  expect(pending).toHaveLength(1); // only the head is on the timer; 'fast' waits in the queue

  // Drive the clock: fire due callbacks, draining the microtask each leaves behind.
  clock = 100;
  while (pending.some((p) => p.at <= clock)) {
    const i = pending.findIndex((p) => p.at <= clock);
    const [p] = pending.splice(i, 1);
    if (p) p.fn();
    await Promise.resolve(); // let the head's follow-up (a due `defer`) run
  }
  expect(seen).toEqual(['slow', 'fast']); // send order, though 'fast' had the shorter delay
});

it('ignores a non-finite delay rather than storing NaN or Infinity', async () => {
  const io = new Server('http://localhost');
  let delaying!: DelayingAdapter;
  io.adapter(() => (delaying = new DelayingAdapter()));

  const { client, serverSocket } = await connect(io);
  const seen: string[] = [];
  client.on('ev', (v: string) => seen.push(v));

  delaying.setDelay(serverSocket.id, Number.NaN); // ignored: NaN is not a delay
  serverSocket.emit('ev', 'x');
  await flush();
  expect(seen).toEqual(['x']); // delivered next tick, not stuck on a NaN fire time
});
