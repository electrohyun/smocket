import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

const RESERVED_EVENTS = [
  'connect',
  'connect_error',
  'disconnect',
  'disconnecting',
  'newListener',
  'removeListener',
] as const;

const reservedError = (event: string): Error => new Error(`"${event}" is a reserved event name`);

const ctx = setupServer();

function expectReservedEventsRejected(
  surfaces: Array<[name: string, emit: (event: string) => unknown]>,
): void {
  for (const [name, emit] of surfaces) {
    for (const event of RESERVED_EVENTS) {
      expect(() => emit(event), `${name}.emit(${event})`).toThrowError(reservedError(event));
    }
    expect(() => emit(`application:${name}`), `${name} accepts an application event`).not.toThrow();
  }
}

it('server emit surfaces reject the six reserved names and accept application events', async () => {
  const { serverSocket } = await ctx.connectClient();
  await serverSocket.join('room');

  expectReservedEventsRejected([
    ['server', (event) => ctx.io.emit(event)],
    ['namespace', (event) => ctx.io.of('/').emit(event)],
    ['broadcast', (event) => ctx.io.to('room').emit(event)],
    ['broadcast timeout', (event) => ctx.io.to('room').timeout(20).emit(event)],
    ['broadcast volatile', (event) => ctx.io.to('room').volatile.emit(event)],
    ['namespace timeout', (event) => ctx.io.of('/').timeout(20).emit(event)],
    ['namespace volatile', (event) => ctx.io.of('/').volatile.emit(event)],
    ['server socket', (event) => serverSocket.emit(event)],
    ['server socket timeout', (event) => serverSocket.timeout(20).emit(event)],
    ['server socket volatile', (event) => serverSocket.volatile.emit(event)],
    ['socket broadcast', (event) => serverSocket.broadcast.emit(event)],
    ['socket timeout broadcast', (event) => serverSocket.timeout(20).broadcast.emit(event)],
    ['socket volatile broadcast', (event) => serverSocket.volatile.broadcast.emit(event)],
  ]);
});

it('client emit surfaces reject the six reserved names and accept application events', async () => {
  const { client } = await ctx.connectClient();

  expectReservedEventsRejected([
    ['client socket', (event) => client.emit(event)],
    ['client socket timeout', (event) => client.timeout(20).emit(event)],
    ['client socket volatile', (event) => client.volatile.emit(event)],
  ]);
});

it('client wrappers reject reserved names while the connection is still pending', async () => {
  const serverConnection = ctx.nextConnection();
  const client = ctx.openClient();
  const connected = new Promise<void>((resolve) => client.once('connect', () => resolve()));
  const outgoing: string[] = [];
  client.onAnyOutgoing((event) => outgoing.push(String(event)));

  expect(client.connected).toBe(false);
  expect(() => client.emit('disconnect')).toThrowError(reservedError('disconnect'));
  expect(() => client.timeout(20).emit('disconnect')).toThrowError(reservedError('disconnect'));
  expect(() => client.volatile.emit('disconnect')).toThrowError(reservedError('disconnect'));
  await expect(client.emitWithAck('disconnect')).rejects.toThrowError(reservedError('disconnect'));
  await expect(client.timeout(20).emitWithAck('disconnect')).rejects.toThrowError(
    reservedError('disconnect'),
  );
  await expect(client.volatile.emitWithAck('disconnect')).rejects.toThrowError(
    reservedError('disconnect'),
  );

  const serverSocket = await serverConnection;
  await connected;
  const marker = new Promise<void>((resolve) =>
    serverSocket.once('client-marker', () => resolve()),
  );
  client.emit('client-marker');
  await marker;

  expect(outgoing).toEqual(['client-marker']);
});

it('rejected server emits reach neither the peer nor outgoing catch-alls', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  await serverSocket.join('room');

  const received = track(client, 'connect_error');
  const outgoing: string[] = [];
  serverSocket.onAnyOutgoing((event) => outgoing.push(String(event)));

  for (const emit of [
    () => ctx.io.emit('connect_error'),
    () => ctx.io.of('/').emit('connect_error'),
    () => ctx.io.to('room').emit('connect_error'),
    () => ctx.io.timeout(20).emit('connect_error'),
    () => ctx.io.volatile.emit('connect_error'),
    () => serverSocket.emit('connect_error'),
    () => serverSocket.timeout(20).emit('connect_error'),
    () => serverSocket.volatile.emit('connect_error'),
  ]) {
    expect(emit).toThrowError(reservedError('connect_error'));
  }

  const marker = receive(client, 'server-marker');
  serverSocket.emit('server-marker');
  await marker;

  expect(received.received).toBe(false);
  expect(outgoing).toEqual(['server-marker']);
});

it('rejected client emits reach neither the peer nor outgoing catch-alls', async () => {
  const { client, serverSocket } = await ctx.connectClient();

  const received = { value: false };
  serverSocket.on('connect_error', () => {
    received.value = true;
  });
  const outgoing: string[] = [];
  client.onAnyOutgoing((event) => outgoing.push(String(event)));

  for (const emit of [
    () => client.emit('connect_error'),
    () => client.timeout(20).emit('connect_error'),
    () => client.volatile.emit('connect_error'),
  ]) {
    expect(emit).toThrowError(reservedError('connect_error'));
  }

  const marker = new Promise<void>((resolve) =>
    serverSocket.once('client-marker', () => resolve()),
  );
  client.emit('client-marker');
  await marker;

  expect(received.value).toBe(false);
  expect(outgoing).toEqual(['client-marker']);
});

it('a rejected client event retains its timeout for the next completed emit', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('echo', (ack: (value: string) => void) => ack('answer'));

  client.timeout(1000);
  expect(() => client.emit('disconnect')).toThrowError(reservedError('disconnect'));
  const first = await new Promise<unknown[]>((resolve) => {
    client.emit('echo', (...args: unknown[]) => resolve(args));
  });
  const second = await new Promise<unknown[]>((resolve) => {
    client.emit('echo', (...args: unknown[]) => resolve(args));
  });

  expect(first).toEqual([null, 'answer']);
  expect(second).toEqual(['answer']);
});

it('emitWithAck rejects reserved names without firing outgoing catch-alls', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverOutgoing: string[] = [];
  const clientOutgoing: string[] = [];
  serverSocket.onAnyOutgoing((event) => serverOutgoing.push(String(event)));
  client.onAnyOutgoing((event) => clientOutgoing.push(String(event)));

  for (const emit of [
    () => serverSocket.emitWithAck('disconnect'),
    () => serverSocket.timeout(20).emitWithAck('disconnect'),
    () => serverSocket.volatile.emitWithAck('disconnect'),
    () => client.emitWithAck('disconnect'),
    () => client.timeout(20).emitWithAck('disconnect'),
    () => client.volatile.emitWithAck('disconnect'),
  ]) {
    await expect(emit()).rejects.toThrowError(reservedError('disconnect'));
  }

  expect(serverOutgoing).toEqual([]);
  expect(clientOutgoing).toEqual([]);
});

it('connection and new_namespace remain ordinary public payload event names', async () => {
  const { client, serverSocket } = await ctx.connectClient();

  for (const event of ['connection', 'new_namespace']) {
    const atClient = receive(client, event);
    serverSocket.emit(event, `server:${event}`);
    await expect(atClient).resolves.toBe(`server:${event}`);

    const atServer = new Promise<unknown>((resolve) => serverSocket.once(event, resolve));
    client.emit(event, `client:${event}`);
    await expect(atServer).resolves.toBe(`client:${event}`);
  }
});
