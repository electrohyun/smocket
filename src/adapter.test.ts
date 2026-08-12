import { expect, it } from 'vitest';
import { Adapter, Server } from './index';
import { receive, track } from './test-events';

// These tests exercise smocket's own `io.adapter` seam, so they import the Server
// directly rather than through the dual-run `setupServer`: real socket.io has no
// signature-compatible counterpart (see docs/differences.md §B), so there is
// nothing to compare against. They run identically under both `pnpm test` targets.

/**
 * A trace adapter: it records the target set of every routing query and otherwise
 * behaves exactly like the built-in one. This is the "observe the target set"
 * use, and it is the shape a custom adapter takes: extend `Adapter`, override
 * `socketsIn`, reuse the inherited membership bookkeeping.
 */
class SpyAdapter extends Adapter {
  readonly targeted: Array<Set<string>> = [];

  override socketsIn(rooms: Iterable<string>): Set<string> {
    const result = super.socketsIn(rooms);
    if (result.size > 0) this.targeted.push(new Set(result));
    return result;
  }
}

/**
 * A drop adapter: it removes one chosen sid from the target set, routing that
 * socket out of every broadcast. This is the "narrow the target set" use, pure
 * targeting with no effect on delivery order.
 */
class DropAdapter extends Adapter {
  block: string | undefined;

  override socketsIn(rooms: Iterable<string>): Set<string> {
    const result = super.socketsIn(rooms);
    if (this.block !== undefined) result.delete(this.block);
    return result;
  }
}

it('io.adapter registers a custom adapter that observes the routing decision', async () => {
  const server = new Server('http://localhost');
  const spy = new SpyAdapter();
  // The factory receives the namespace; this example does not need it. One
  // namespace is used here, so returning a single prebuilt instance is enough.
  server.adapter(() => spy);

  const client1 = server.connect();
  const socket1 = await server.nextConnection();
  server.connect();
  const socket2 = await server.nextConnection();
  await socket1.join('room');

  const got1 = receive(client1, 'msg');
  server.to('room').emit('msg', 'hello');

  await expect(got1).resolves.toBe('hello');
  // The spy saw the room's single member as the broadcast's target set, and never
  // the socket outside the room.
  expect(spy.targeted.some((set) => set.size === 1 && set.has(socket1.id))).toBe(true);
  expect(spy.targeted.every((set) => !set.has(socket2.id))).toBe(true);
});

it('a custom adapter can drop a socket from the target set, and per-socket order still holds', async () => {
  const server = new Server('http://localhost');
  const drop = new DropAdapter();
  server.adapter(() => drop);

  const client1 = server.connect();
  const socket1 = await server.nextConnection();
  const client2 = server.connect();
  const socket2 = await server.nextConnection();
  await socket1.join('all');
  await socket2.join('all');
  drop.block = socket2.id;

  const got1 = receive(client1, 'msg');
  const missed2 = track(client2, 'msg');
  const marker2 = receive(client2, 'marker');

  server.to('all').emit('msg', 'hello');
  socket2.emit('marker');

  await expect(got1).resolves.toBe('hello');
  await marker2;
  // socket2 was routed out of the broadcast. The marker, sent later on the same
  // socket, arriving proves the msg was never coming: the drop is real, and it
  // relies on per-socket FIFO (0010), which the custom adapter did not disturb.
  expect(missed2.received).toBe(false);
});

it('registering a custom adapter preserves per-socket delivery order', async () => {
  const server = new Server('http://localhost');
  server.adapter(() => new SpyAdapter());

  const client1 = server.connect();
  const socket1 = await server.nextConnection();
  await socket1.join('all');

  const order: string[] = [];
  client1.on('a', () => order.push('a'));
  client1.on('b', () => order.push('b'));
  const done = receive(client1, 'marker');

  server.to('all').emit('a');
  server.to('all').emit('b');
  socket1.emit('marker');

  await done;
  // Two broadcasts routed through the custom adapter, then a direct marker: the
  // socket still observes them in send order, so the adapter changed targeting
  // without touching the delivery path.
  expect(order).toEqual(['a', 'b']);
});

it('builds an independent registered adapter for each dynamic concrete child', async () => {
  const server = new Server('http://localhost');
  const adapters = new Map<string, SpyAdapter>();
  server.adapter((namespace) => {
    const adapter = new SpyAdapter();
    adapters.set(namespace.name, adapter);
    return adapter;
  });
  server.of(/^\/tenant-/);

  const a = server.connect('/tenant-a');
  const b = server.connect('/tenant-b');
  await Promise.all([receive(a, 'connect'), receive(b, 'connect')]);

  expect(adapters.get('/tenant-a')).toBe(server.of('/tenant-a').adapter);
  expect(adapters.get('/tenant-b')).toBe(server.of('/tenant-b').adapter);
  expect(adapters.get('/tenant-a')).not.toBe(adapters.get('/tenant-b'));
  await server.close();
});
