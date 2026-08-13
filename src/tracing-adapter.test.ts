import { expect, it, vi } from 'vitest';
import type { BroadcastTrace } from './contract';
import { Adapter, DelayingAdapter, Server, TracingAdapter } from './index';
import { observeDisconnect } from './test-events';

async function connect(io: Server, namespace = '/') {
  const client = io.connect(namespace);
  const serverSocket = await io.nextConnection(namespace);
  return { client, serverSocket };
}

function registerTracers(io: Server): Map<string, TracingAdapter> {
  const tracers = new Map<string, TracingAdapter>();
  io.adapter((namespace) => {
    const tracer = new TracingAdapter();
    tracers.set(namespace.name, tracer);
    return tracer;
  });
  return tracers;
}

function rootTracer(tracers: Map<string, TracingAdapter>): TracingAdapter {
  const tracer = tracers.get('/');
  if (!tracer) throw new Error('root tracer was not created');
  return tracer;
}

it('records one final decision for Server, Namespace, room, exclusion, and Socket entry points', async () => {
  const io = new Server('http://localhost');
  const tracers = registerTracers(io);
  const a = await connect(io);
  const b = await connect(io);
  const c = await connect(io);
  a.serverSocket.join('selected');
  b.serverSocket.join(['selected', 'muted']);

  io.emit('server');
  io.of('/').emit('namespace');
  io.to('selected').except('muted').emit('room');
  b.serverSocket.broadcast.emit('broadcast');
  b.serverSocket.to('selected').emit('socket-room');

  expect(rootTracer(tracers).getTraces()).toEqual([
    {
      event: 'server',
      rooms: [],
      exceptRooms: [],
      excluded: [],
      recipients: [a.serverSocket.id, b.serverSocket.id, c.serverSocket.id],
      volatile: false,
    },
    {
      event: 'namespace',
      rooms: [],
      exceptRooms: [],
      excluded: [],
      recipients: [a.serverSocket.id, b.serverSocket.id, c.serverSocket.id],
      volatile: false,
    },
    {
      event: 'room',
      rooms: ['selected'],
      exceptRooms: ['muted'],
      excluded: [b.serverSocket.id],
      recipients: [a.serverSocket.id],
      volatile: false,
    },
    {
      event: 'broadcast',
      rooms: [],
      exceptRooms: [b.serverSocket.id],
      excluded: [b.serverSocket.id],
      recipients: [a.serverSocket.id, c.serverSocket.id],
      volatile: false,
    },
    {
      event: 'socket-room',
      rooms: ['selected'],
      exceptRooms: [b.serverSocket.id],
      excluded: [b.serverSocket.id],
      recipients: [a.serverSocket.id],
      volatile: false,
    },
  ]);
  await io.close();
});

it('keeps root and named namespace history isolated', async () => {
  const io = new Server('http://localhost');
  const game = io.of('/game');
  const tracers = registerTracers(io);
  const root = await connect(io);
  const named = await connect(io, '/game');

  io.emit('root-event');
  game.emit('named-event');

  expect(rootTracer(tracers).getTraces()).toMatchObject([
    { event: 'root-event', recipients: [root.serverSocket.id] },
  ]);
  expect(tracers.get('/game')?.getTraces()).toMatchObject([
    { event: 'named-event', recipients: [named.serverSocket.id] },
  ]);
  expect(tracers.get('/game')).not.toBe(rootTracer(tracers));
  await io.close();
});

it('records a dynamic parent broadcast once in each concrete namespace', async () => {
  const io = new Server('http://localhost');
  const parent = io.of(/^\/tenant-/);
  const tracers = registerTracers(io);
  const first = await connect(io, '/tenant-a');
  const second = await connect(io, '/tenant-b');

  parent.emit('parent-event');

  expect(rootTracer(tracers).getTraces()).toEqual([]);
  expect(tracers.get('/tenant-a')?.getTraces()).toMatchObject([
    { event: 'parent-event', recipients: [first.serverSocket.id] },
  ]);
  expect(tracers.get('/tenant-b')?.getTraces()).toMatchObject([
    { event: 'parent-event', recipients: [second.serverSocket.id] },
  ]);
  await io.close();
});

it('records empty and volatile final recipient sets plus callback and Promise ack broadcasts', async () => {
  const io = new Server('http://localhost');
  const tracers = registerTracers(io);
  io.to('missing').emit('empty');
  io.on('connection', () => io.volatile.emit('preconnect'));
  const { client, serverSocket } = await connect(io);
  client.on('callback', (ack: (value: string) => void) => ack('callback-answer'));
  client.on('promise', (ack: (value: string) => void) => ack('promise-answer'));

  const callback = await new Promise<unknown[]>((resolve) => {
    io.timeout(1000).emit('callback', (...args: unknown[]) => resolve(args));
  });
  const promised = await io.timeout(1000).emitWithAck('promise');
  io.volatile.emit('connected-volatile');

  expect(callback).toEqual([null, ['callback-answer']]);
  expect(promised).toEqual(['promise-answer']);
  expect(rootTracer(tracers).getTraces()).toMatchObject([
    { event: 'empty', recipients: [], volatile: false },
    { event: 'preconnect', recipients: [], volatile: true },
    { event: 'callback', recipients: [serverSocket.id], volatile: false },
    { event: 'promise', recipients: [serverSocket.id], volatile: false },
    { event: 'connected-volatile', recipients: [serverSocket.id], volatile: true },
  ]);
  await io.close();
});

it('records before outgoing observation and delivery without changing FIFO', async () => {
  const order: string[] = [];
  class OrderedTracer extends TracingAdapter {
    override traceBroadcast(trace: BroadcastTrace): void {
      order.push('trace');
      super.traceBroadcast(trace);
    }
  }

  const io = new Server('http://localhost');
  const tracer = new OrderedTracer();
  io.adapter(() => tracer);
  const { client, serverSocket } = await connect(io);
  serverSocket.onAnyOutgoing(() => order.push('outgoing'));
  client.on('first', () => order.push('first'));
  const secondReceived = new Promise<void>((resolve) =>
    client.on('second', () => {
      order.push('second');
      resolve();
    }),
  );

  io.emit('first');
  io.emit('second');
  expect(order).toEqual(['trace', 'outgoing', 'trace', 'outgoing']);
  await secondReceived;
  expect(order).toEqual(['trace', 'outgoing', 'trace', 'outgoing', 'first', 'second']);
  await io.close();
});

it('excludes direct socket traffic and failed broadcast encoding', async () => {
  const io = new Server('http://localhost');
  const tracers = registerTracers(io);
  const { client, serverSocket } = await connect(io);
  const receivedByClient = new Promise<void>((resolve) => client.once('down', () => resolve()));
  const receivedByServer = new Promise<void>((resolve) => serverSocket.once('up', () => resolve()));

  serverSocket.emit('down');
  client.emit('up');
  await Promise.all([receivedByClient, receivedByServer]);

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  expect(() => io.emit('bad-payload', circular)).toThrow();
  expect(() => io.emit('disconnect')).toThrow();
  expect(rootTracer(tracers).getTraces()).toEqual([]);
  await io.close();
});

it('returns caller-cleared immutable snapshots with no payload reference', async () => {
  const io = new Server('http://localhost');
  const tracers = registerTracers(io);
  const { serverSocket } = await connect(io);
  const payload = { nested: { value: 1 } };

  io.emit('snapshot', payload);
  payload.nested.value = 2;
  const history = rootTracer(tracers).getTraces();
  const trace = history[0];
  if (!trace) throw new Error('trace was not recorded');

  expect(trace).toEqual({
    event: 'snapshot',
    rooms: [],
    exceptRooms: [],
    excluded: [],
    recipients: [serverSocket.id],
    volatile: false,
  });
  expect(trace).not.toHaveProperty('payload');
  expect(Object.isFrozen(history)).toBe(true);
  expect(Object.isFrozen(trace)).toBe(true);
  expect(Object.isFrozen(trace.rooms)).toBe(true);
  expect(Object.isFrozen(trace.exceptRooms)).toBe(true);
  expect(Object.isFrozen(trace.excluded)).toBe(true);
  expect(Object.isFrozen(trace.recipients)).toBe(true);

  rootTracer(tracers).clear();
  expect(rootTracer(tracers).getTraces()).toEqual([]);
  expect(history).toHaveLength(1);
  await io.close();
});

it('observes recipients after a wrapped custom adapter changes routing', async () => {
  class DropAdapter extends Adapter {
    blocked: string | undefined;

    override socketsIn(rooms: Iterable<string>): Set<string> {
      const result = super.socketsIn(rooms);
      if (this.blocked) result.delete(this.blocked);
      return result;
    }
  }

  const io = new Server('http://localhost');
  const routing = new DropAdapter();
  const tracer = new TracingAdapter(routing);
  io.adapter(() => tracer);
  const first = await connect(io);
  const second = await connect(io);
  first.serverSocket.join('room');
  second.serverSocket.join('room');
  routing.blocked = second.serverSocket.id;

  io.to('room').emit('filtered');

  expect(tracer.getTraces()).toMatchObject([
    { event: 'filtered', recipients: [first.serverSocket.id] },
  ]);
  await io.close();
});

it('composes with DelayingAdapter scheduling and removal', async () => {
  vi.useFakeTimers();
  try {
    const io = new Server('http://localhost');
    const delaying = new DelayingAdapter();
    const tracer = new TracingAdapter(delaying);
    io.adapter(() => tracer);
    const { client, serverSocket } = await connect(io);
    const received: string[] = [];
    client.on('event', (value: string) => received.push(value));

    delaying.setDelay(serverSocket.id, 20);
    io.emit('event', 'delayed');
    expect(tracer.getTraces()).toMatchObject([{ event: 'event', recipients: [serverSocket.id] }]);
    await Promise.resolve();
    expect(received).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(received).toEqual(['delayed']);

    delaying.setDelay(serverSocket.id, 100);
    io.emit('event', 'drained');
    const { disconnected } = observeDisconnect(serverSocket);
    client.disconnect();
    await disconnected;
    expect(received).toEqual(['delayed', 'drained']);
    await vi.advanceTimersByTimeAsync(100);
    expect(received).toEqual(['delayed', 'drained']);
  } finally {
    vi.useRealTimers();
  }
});
