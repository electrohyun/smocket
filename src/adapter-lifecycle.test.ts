import { expect, it } from 'vitest';
import type { NamespaceContract, ServerSocketContract } from './contract';
import { Adapter, Server } from './index';
import { observeDisconnect, receive } from './test-events';

type RuntimeNamespace = NamespaceContract & {
  sockets: Map<string, ServerSocketContract>;
};

class RemovalAdapter extends Adapter {
  onRemove: ((sid: string) => void) | undefined;
  readonly removals: Array<{
    sid: string;
    hasRoomMember: boolean;
    hasSidEntry: boolean;
    inNamespaceRoster: boolean;
  }> = [];

  constructor(private readonly namespace: RuntimeNamespace) {
    super();
  }

  removeSocket(sid: string): void {
    this.onRemove?.(sid);
    this.removals.push({
      sid,
      hasRoomMember: [...this.rooms.values()].some((members) => members.has(sid)),
      hasSidEntry: this.sids.has(sid),
      inNamespaceRoster: this.namespace.sockets.has(sid),
    });
  }
}

function registerRemovalAdapters(io: Server): Map<string, RemovalAdapter> {
  const adapters = new Map<string, RemovalAdapter>();
  io.adapter((namespace) => {
    const adapter = new RemovalAdapter(namespace as RuntimeNamespace);
    adapters.set(namespace.name, adapter);
    return adapter;
  });
  return adapters;
}

it('builds isolated adapters for root, existing, future static, and dynamic namespaces', async () => {
  const io = new Server('http://localhost');
  const existing = io.of('/existing');
  const adapters = new Map<string, Adapter>();

  io.adapter((namespace) => {
    const adapter = new Adapter();
    adapters.set(namespace.name, adapter);
    return adapter;
  });

  const future = io.of('/future');
  io.of(/^\/tenant-/);
  io.connect();
  const rootSocket = await io.nextConnection();
  io.connect('/existing');
  const existingSocket = await io.nextConnection('/existing');
  io.connect('/future');
  const futureSocket = await io.nextConnection('/future');
  const tenant = io.connect('/tenant-a');
  await receive(tenant, 'connect');

  expect([...adapters.keys()]).toEqual(['/', '/existing', '/future', '/tenant-a']);
  expect(io.of('/').adapter).toBe(adapters.get('/'));
  expect(existing.adapter).toBe(adapters.get('/existing'));
  expect(future.adapter).toBe(adapters.get('/future'));
  expect(io.of('/tenant-a').adapter).toBe(adapters.get('/tenant-a'));
  expect(new Set(adapters.values()).size).toBe(4);
  expect([...(adapters.get('/')?.sids.keys() ?? [])]).toEqual([rootSocket.id]);
  expect([...(adapters.get('/existing')?.sids.keys() ?? [])]).toEqual([existingSocket.id]);
  expect([...(adapters.get('/future')?.sids.keys() ?? [])]).toEqual([futureSocket.id]);
  expect(adapters.get('/tenant-a')?.sids.size).toBe(1);
  await io.close();
});

it('keeps every existing adapter unchanged when replacement construction fails', () => {
  const io = new Server('http://localhost');
  const root = io.of('/');
  const existing = io.of('/existing');
  io.adapter(() => new Adapter());
  const originalRoot = root.adapter;
  const originalExisting = existing.adapter;

  expect(() =>
    io.adapter((namespace) => {
      if (namespace.name === '/existing') throw new Error('factory failed');
      return new Adapter();
    }),
  ).toThrow('factory failed');

  expect(root.adapter).toBe(originalRoot);
  expect(existing.adapter).toBe(originalExisting);
});

it('rejects one adapter instance shared by multiple namespaces without partial replacement', () => {
  const io = new Server('http://localhost');
  const root = io.of('/');
  const existing = io.of('/existing');
  const originalRoot = root.adapter;
  const originalExisting = existing.adapter;
  const shared = new Adapter();

  expect(() => io.adapter(() => shared)).toThrow(
    'adapter factory must return a fresh instance for each namespace',
  );
  expect(root.adapter).toBe(originalRoot);
  expect(existing.adapter).toBe(originalExisting);
});

it('reports dynamic adapter construction failure and lets the client retry', async () => {
  const io = new Server('http://localhost');
  let childAttempts = 0;
  const created: string[] = [];
  io.adapter((namespace) => {
    if (namespace.name === '/tenant-a' && childAttempts++ < 2) {
      if (childAttempts === 1) throw new Error('child adapter failed');
      throw 'child adapter failed again';
    }
    created.push(namespace.name);
    return new Adapter();
  });
  io.of(/^\/tenant-/);

  const client = io.connect('/tenant-a');
  await expect(receive(client, 'connect_error')).resolves.toMatchObject({
    message: 'child adapter failed',
  });

  const secondError = receive(client, 'connect_error');
  client.connect();
  await expect(secondError).resolves.toMatchObject({ message: 'child adapter failed again' });

  const connected = receive(client, 'connect');
  client.connect();
  await connected;
  expect(created).toEqual(['/', '/tenant-a']);
  expect(io.of('/tenant-a').adapter).toBeInstanceOf(Adapter);
});

it('does not register a future static namespace when its adapter construction fails', () => {
  const io = new Server('http://localhost');
  let attempts = 0;
  io.adapter((namespace) => {
    if (namespace.name === '/future' && attempts++ === 0) throw new Error('future failed');
    return new Adapter();
  });

  expect(() => io.of('/future')).toThrow('future failed');
  const future = io.of('/future');
  expect(attempts).toBe(2);
  expect(future.adapter).toBeInstanceOf(Adapter);
});

it('rejects reusing an existing adapter for a future namespace', () => {
  const io = new Server('http://localhost');
  const shared = new Adapter();
  io.adapter(() => shared);

  expect(() => io.of('/future')).toThrow(
    'adapter factory must return a fresh instance for each namespace',
  );

  io.adapter(() => new Adapter());
  expect(io.of('/future').adapter).toBeInstanceOf(Adapter);
});

it('closes adapter registration at the first connection attempt, including rejection', async () => {
  const io = new Server('http://localhost');
  const client = io.connect('/missing');
  await expect(receive(client, 'connect_error')).resolves.toMatchObject({
    message: 'Invalid namespace',
  });

  expect(() => io.adapter(() => new Adapter())).toThrow(
    'adapter must be registered before the first connection attempt',
  );
});

it.each(['client', 'server', 'manager', 'close'] as const)(
  'signals whole-socket removal once for the %s teardown path',
  async (path) => {
    const io = new Server(`http://localhost:${4100 + path.length}`);
    const adapters = registerRemovalAdapters(io);
    const client = io.connect();
    const socket = await io.nextConnection();
    socket.join('room');
    const order: string[] = [];
    socket.on('disconnecting', () => order.push('disconnecting'));
    socket.on('disconnect', () => order.push('disconnect'));
    const adapter = adapters.get('/');
    if (!adapter) throw new Error('root adapter was not created');
    adapter.onRemove = () => order.push('removeSocket');
    const { disconnected } = observeDisconnect(socket);

    if (path === 'client') client.disconnect();
    if (path === 'server') socket.disconnect();
    if (path === 'manager') socket.disconnect(true);
    if (path === 'close') await io.close();
    await disconnected;

    client.disconnect();
    socket.disconnect(true);
    await io.close();
    expect(order).toEqual(['disconnecting', 'removeSocket', 'disconnect']);
    expect(adapter.removals).toEqual([
      {
        sid: socket.id,
        hasRoomMember: false,
        hasSidEntry: false,
        inNamespaceRoster: true,
      },
    ]);
  },
);

it('signals cleanup once for rejected and cancelled admission without lifecycle events', async () => {
  for (const mode of ['rejected', 'cancelled'] as const) {
    const io = new Server(`http://localhost:${4200 + mode.length}`);
    const adapters = registerRemovalAdapters(io);
    let provisional: ServerSocketContract | undefined;
    const lifecycle: string[] = [];
    io.use((socket, next) => {
      provisional = socket;
      socket.on('disconnecting', () => lifecycle.push('disconnecting'));
      socket.on('disconnect', () => lifecycle.push('disconnect'));
      socket.join('temporary');
      if (mode === 'rejected') next(new Error('denied'));
    });

    const client = io.connect();
    if (mode === 'rejected') {
      await expect(receive(client, 'connect_error')).resolves.toMatchObject({ message: 'denied' });
    } else {
      client.disconnect();
    }

    expect(provisional).toBeDefined();
    expect(lifecycle).toEqual([]);
    expect(adapters.get('/')?.removals).toEqual([
      {
        sid: provisional?.id,
        hasRoomMember: false,
        hasSidEntry: false,
        inNamespaceRoster: false,
      },
    ]);
    client.disconnect();
    await io.close();
    expect(adapters.get('/')?.removals).toHaveLength(1);
  }
});
