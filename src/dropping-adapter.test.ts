import { expect, it } from 'vitest';
import {
  Adapter,
  DelayingAdapter,
  DroppingAdapter,
  Server,
  TracingAdapter,
  type DeliveryTimer,
} from './index';
import { observeDisconnect, receive, track } from './test-events';

async function connect(io: Server, namespace = '/') {
  const client = io.connect(namespace);
  const serverSocket = await io.nextConnection(namespace);
  return { client, serverSocket };
}

function registerDroppers(io: Server): Map<string, DroppingAdapter> {
  const adapters = new Map<string, DroppingAdapter>();
  io.adapter((namespace) => {
    const adapter = new DroppingAdapter();
    adapters.set(namespace.name, adapter);
    return adapter;
  });
  return adapters;
}

it('drops io.emit by sid and restores delivery without changing membership', async () => {
  const io = new Server('http://localhost');
  const adapters = registerDroppers(io);
  const kept = await connect(io);
  const dropped = await connect(io);
  const adapter = adapters.get('/');
  if (!adapter) throw new Error('root dropping adapter was not created');
  const keptMessage = receive(kept.client, 'message');
  const droppedMessage = track(dropped.client, 'message');
  const marker = receive(dropped.client, 'marker');

  adapter.setDropped('unknown');
  expect(adapter.isDropped('unknown')).toBe(false);
  adapter.setDropped(dropped.serverSocket.id);
  io.emit('message', 'kept');
  dropped.serverSocket.emit('marker', 'after-broadcast');

  await expect(keptMessage).resolves.toBe('kept');
  await expect(marker).resolves.toBe('after-broadcast');
  expect(droppedMessage.received).toBe(false);
  expect(adapter.rooms.get(dropped.serverSocket.id)).toEqual(new Set([dropped.serverSocket.id]));

  adapter.setDropped(dropped.serverSocket.id, false);
  const restored = receive(dropped.client, 'restored');
  io.emit('restored', 'again');
  await expect(restored).resolves.toBe('again');
  await io.close();
});

it('preserves room union, exclusions, sender exclusion, and unaffected direct traffic', async () => {
  const io = new Server('http://localhost');
  const adapters = registerDroppers(io);
  const first = await connect(io);
  const second = await connect(io);
  const excluded = await connect(io);
  first.serverSocket.join('one');
  second.serverSocket.join('two');
  excluded.serverSocket.join(['one', 'muted']);
  const adapter = adapters.get('/');
  if (!adapter) throw new Error('root dropping adapter was not created');
  adapter.setDropped(second.serverSocket.id);

  const firstRoom = receive(first.client, 'room');
  const secondRoom = track(second.client, 'room');
  const excludedRoom = track(excluded.client, 'room');
  const secondMarker = receive(second.client, 'marker');
  const excludedMarker = receive(excluded.client, 'marker');
  io.to(['one', 'two']).except('muted').emit('room', 'selected');
  second.serverSocket.emit('marker', 'room-finished');
  excluded.serverSocket.emit('marker', 'room-finished');
  await expect(firstRoom).resolves.toBe('selected');
  await Promise.all([
    expect(secondMarker).resolves.toBe('room-finished'),
    expect(excludedMarker).resolves.toBe('room-finished'),
  ]);
  expect(secondRoom.received).toBe(false);
  expect(excludedRoom.received).toBe(false);

  const directDown = receive(second.client, 'direct-down');
  const directUp = new Promise<unknown>((resolve) =>
    second.serverSocket.once('direct-up', resolve),
  );
  second.serverSocket.emit('direct-down', 'server');
  second.client.emit('direct-up', 'client');
  await expect(directDown).resolves.toBe('server');
  await expect(directUp).resolves.toBe('client');

  const senderSaw = track(second.client, 'sender-broadcast');
  const firstSaw = receive(first.client, 'sender-broadcast');
  const senderMarker = receive(second.client, 'marker');
  second.serverSocket.broadcast.emit('sender-broadcast', 'other');
  second.serverSocket.emit('marker', 'sender-finished');
  await expect(firstSaw).resolves.toBe('other');
  await expect(senderMarker).resolves.toBe('sender-finished');
  expect(senderSaw.received).toBe(false);
  await io.close();
});

it('removes dropped recipients from callback and Promise acknowledgement collection', async () => {
  const io = new Server('http://localhost');
  const adapters = registerDroppers(io);
  const first = await connect(io);
  const second = await connect(io);
  first.client.on('answer', (ack: (value: string) => void) => ack('first'));
  second.client.on('answer', (ack: (value: string) => void) => ack('second'));
  const adapter = adapters.get('/');
  if (!adapter) throw new Error('root dropping adapter was not created');
  adapter.setDropped(second.serverSocket.id);

  await expect(io.timeout(1000).emitWithAck('answer')).resolves.toEqual(['first']);
  adapter.setDropped(first.serverSocket.id);
  await expect(io.timeout(1000).emitWithAck('answer')).resolves.toEqual([]);
  await io.close();
});

it('does not cancel a broadcast acknowledgement already selected before the drop', async () => {
  const io = new Server('http://localhost');
  const adapters = registerDroppers(io);
  const { client, serverSocket } = await connect(io);
  let answer: ((value: string) => void) | undefined;
  let receivedRequest!: () => void;
  const request = new Promise<void>((resolve) => (receivedRequest = resolve));
  client.on('held-answer', (ack: (value: string) => void) => {
    answer = ack;
    receivedRequest();
  });
  const adapter = adapters.get('/');
  if (!adapter) throw new Error('root dropping adapter was not created');

  const result = io.timeout(1000).emitWithAck('held-answer');
  await request;
  adapter.setDropped(serverSocket.id);
  answer?.('already-selected');

  await expect(result).resolves.toEqual(['already-selected']);
  await io.close();
});

it('skips outgoing observation for dropped delivery and preserves remaining FIFO', async () => {
  const io = new Server('http://localhost');
  const adapters = registerDroppers(io);
  const kept = await connect(io);
  const dropped = await connect(io);
  const adapter = adapters.get('/');
  if (!adapter) throw new Error('root dropping adapter was not created');
  adapter.setDropped(dropped.serverSocket.id);
  const keptOrder: string[] = [];
  const droppedOrder: string[] = [];
  kept.client.on('event', (value: string) => keptOrder.push(value));
  dropped.client.on('event', (value: string) => droppedOrder.push(value));
  dropped.serverSocket.onAnyOutgoing((event) => droppedOrder.push(`outgoing:${event}`));
  const keptMarker = receive(kept.client, 'marker');
  const droppedMarker = receive(dropped.client, 'marker');

  io.emit('event', 'first');
  io.emit('event', 'second');
  kept.serverSocket.emit('marker', 'done');
  dropped.serverSocket.emit('marker', 'done');
  await Promise.all([keptMarker, droppedMarker]);

  expect(keptOrder).toEqual(['first', 'second']);
  expect(droppedOrder).toEqual(['outgoing:marker']);
  await io.close();
});

it('cleans state on disconnect, gives reconnect a fresh sid, and isolates namespaces', async () => {
  const io = new Server('http://localhost');
  io.of('/game');
  const adapters = registerDroppers(io);
  const root = await connect(io);
  const game = await connect(io, '/game');
  const rootAdapter = adapters.get('/');
  const gameAdapter = adapters.get('/game');
  if (!rootAdapter || !gameAdapter) throw new Error('namespace dropping adapters were not created');
  rootAdapter.setDropped(root.serverSocket.id);
  expect(gameAdapter.isDropped(game.serverSocket.id)).toBe(false);
  const gameEvent = receive(game.client, 'game-event');
  io.of('/game').emit('game-event', 'kept');
  await expect(gameEvent).resolves.toBe('kept');

  const { disconnected } = observeDisconnect(root.serverSocket);
  root.client.disconnect();
  await disconnected;
  expect(rootAdapter.isDropped(root.serverSocket.id)).toBe(false);

  const connected = receive(root.client, 'connect');
  root.client.connect();
  const replacement = await io.nextConnection();
  await connected;
  expect(replacement.id).not.toBe(root.serverSocket.id);
  const fresh = receive(root.client, 'fresh');
  io.emit('fresh', 'delivered');
  await expect(fresh).resolves.toBe('delivered');
  await io.close();
});

it('composes dropping before tracing with wrapped delayed FIFO delivery', async () => {
  let now = 0;
  const scheduled: Array<{ fn: () => void; at: number }> = [];
  const timer: DeliveryTimer = {
    now: () => now,
    schedule: (fn, ms) => scheduled.push({ fn, at: now + ms }),
  };
  const delay = new DelayingAdapter(timer);
  const dropping = new DroppingAdapter(delay);
  const tracing = new TracingAdapter(dropping);
  const io = new Server('http://localhost');
  io.adapter(() => tracing);
  const kept = await connect(io);
  const removed = await connect(io);
  delay.setDelay(kept.serverSocket.id, 10);
  dropping.setDropped(removed.serverSocket.id);
  const received = receive(kept.client, 'event');

  io.emit('event', 'delayed');
  expect(tracing.getTraces()).toMatchObject([
    { recipients: [kept.serverSocket.id], volatile: false },
  ]);
  expect(scheduled).toHaveLength(1);
  now = 10;
  scheduled.shift()?.fn();
  await expect(received).resolves.toBe('delayed');
  await io.close();
});

it('receives the ordered final ids after volatile filtering and cannot add or reorder', async () => {
  class ObservedFilter extends Adapter {
    readonly inputs: string[][] = [];

    filterBroadcastRecipients(sids: readonly string[]): ReadonlySet<string> {
      this.inputs.push([...sids]);
      return new Set(['unknown', ...[...sids].reverse()]);
    }
  }

  const io = new Server('http://localhost');
  const adapter = new ObservedFilter();
  io.adapter(() => adapter);
  const order: string[] = [];
  let observePreconnect = true;
  io.on('connection', (socket) => {
    if (!observePreconnect) return;
    observePreconnect = false;
    io.volatile.emit('preconnect');
    io.emit('ordered');
    socket.emit('marker');
  });
  const first = io.connect();
  first.on('ordered', () => order.push('first'));
  const firstConnected = receive(first, 'marker');
  const firstSocket = await io.nextConnection();
  await firstConnected;

  const second = await connect(io);
  first.on('two-targets', () => order.push('first-two'));
  second.client.on('two-targets', () => order.push('second-two'));
  const firstMarker = receive(first, 'done');
  const secondMarker = receive(second.client, 'done');
  io.emit('two-targets');
  firstSocket.emit('done');
  second.serverSocket.emit('done');
  await Promise.all([firstMarker, secondMarker]);

  expect(adapter.inputs[0]).toEqual([]);
  expect(adapter.inputs[1]).toEqual([firstSocket.id]);
  expect(adapter.inputs.at(-1)).toEqual([firstSocket.id, second.serverSocket.id]);
  expect(order).toEqual(['first', 'first-two', 'second-two']);
  await io.close();
});
