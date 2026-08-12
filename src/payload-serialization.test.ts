import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

const ctx = setupServer();

class CustomPayload {
  constructor(readonly value: string) {}
  method(): string {
    return this.value;
  }
}

it('client-to-server payloads use JSON results and snapshot at emit', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const shared = { count: 1 };
  const source = {
    date: new Date('2026-08-12T00:00:00.000Z'),
    missing: undefined,
    nonfinite: Number.POSITIVE_INFINITY,
    custom: new CustomPayload('kept'),
    first: shared,
    second: shared,
    array: [undefined, Number.NaN, () => undefined, Symbol('value')],
  };
  const received = new Promise<Record<string, unknown>>((resolve) =>
    serverSocket.once('payload', resolve),
  );

  client.emit('payload', source);
  shared.count = 2;

  const value = await received;
  expect(value).toEqual({
    date: '2026-08-12T00:00:00.000Z',
    nonfinite: null,
    custom: { value: 'kept' },
    first: { count: 1 },
    second: { count: 1 },
    array: [null, null, null, null],
  });
  expect(value).not.toHaveProperty('missing');
  expect(value.first).not.toBe(value.second);
  expect(Object.getPrototypeOf(value.custom)).toBe(Object.prototype);
});

it('server-to-client payloads snapshot at emit and decode fresh values', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const shared = { count: 1 };
  const source = { date: new Date('2026-08-12T01:00:00.000Z'), first: shared, second: shared };
  const received = receive(client, 'payload');

  serverSocket.emit('payload', source);
  shared.count = 2;

  await expect(received).resolves.toEqual({
    date: '2026-08-12T01:00:00.000Z',
    first: { count: 1 },
    second: { count: 1 },
  });
  const value = (await received) as typeof source;
  expect(value).not.toBe(source);
  expect(value.first).not.toBe(value.second);
});

it('client-to-server ack requests and responses cross independent snapshots', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let requestSeen: unknown;
  serverSocket.on('question', (request: unknown, ack: (response: unknown) => void) => {
    requestSeen = request;
    const shared = { count: 1 };
    const response = { date: new Date('2026-08-12T02:00:00.000Z'), a: shared, b: shared };
    ack(response);
    shared.count = 2;
  });
  const request = { date: new Date('2026-08-12T01:00:00.000Z'), nested: { count: 1 } };

  const response = (await client.emitWithAck('question', request)) as Record<string, unknown>;
  request.nested.count = 2;

  expect(requestSeen).toEqual({ date: '2026-08-12T01:00:00.000Z', nested: { count: 1 } });
  expect(response).toEqual({
    date: '2026-08-12T02:00:00.000Z',
    a: { count: 1 },
    b: { count: 1 },
  });
  expect(response.a).not.toBe(response.b);
});

it('server-to-client ack requests and responses cross independent snapshots', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let requestSeen: unknown;
  client.on('question', (request: unknown, ack: (response: unknown) => void) => {
    requestSeen = request;
    const response = { date: new Date('2026-08-12T04:00:00.000Z'), nested: { count: 1 } };
    ack(response);
    response.nested.count = 2;
  });
  const request = { date: new Date('2026-08-12T03:00:00.000Z'), nested: { count: 1 } };

  const response = await serverSocket.emitWithAck('question', request);
  request.nested.count = 2;

  expect(requestSeen).toEqual({ date: '2026-08-12T03:00:00.000Z', nested: { count: 1 } });
  expect(response).toEqual({ date: '2026-08-12T04:00:00.000Z', nested: { count: 1 } });
});

it('a buffered client payload stays live until outgoing observation and flush', async () => {
  const received = new Promise<unknown>((resolve) => {
    ctx.io.on('connection', (socket) => socket.once('buffered', resolve));
  });
  const client = ctx.openClient();
  const source = { count: 1 };
  let outgoingCalls = 0;
  client.onAnyOutgoing((_event, payload) => {
    outgoingCalls += 1;
    (payload as { count: number }).count += 1;
  });

  client.emit('buffered', source);
  expect(outgoingCalls).toBe(0);
  source.count = 2;

  await expect(received).resolves.toEqual({ count: 3 });
  expect(outgoingCalls).toBe(1);
});

it('direct outgoing listeners mutate the live source before the snapshot', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const source = { count: 1 };
  serverSocket.onAnyOutgoing((_event, payload) => {
    (payload as { count: number }).count = 2;
  });
  const received = receive(client, 'payload');

  serverSocket.emit('payload', source);
  source.count = 3;

  await expect(received).resolves.toEqual({ count: 2 });
});

it('broadcast snapshots once before outgoing listeners and decodes per recipient', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  const source = { nested: { count: 1 } };
  const outgoing: number[] = [];
  first.serverSocket.onAnyOutgoing((_event, payload) => {
    const value = payload as typeof source;
    outgoing.push(value.nested.count);
    value.nested.count = 2;
  });
  second.serverSocket.onAnyOutgoing((_event, payload) => {
    const value = payload as typeof source;
    outgoing.push(value.nested.count);
    value.nested.count = 3;
  });
  const receivedFirst = receive(first.client, 'payload');
  const receivedSecond = receive(second.client, 'payload');

  ctx.io.emit('payload', source);
  const [a, b] = (await Promise.all([receivedFirst, receivedSecond])) as [
    typeof source,
    typeof source,
  ];

  expect(outgoing).toEqual([1, 2]);
  expect(source.nested.count).toBe(3);
  expect(a).toEqual({ nested: { count: 1 } });
  expect(b).toEqual({ nested: { count: 1 } });
  expect(a).not.toBe(b);
  expect(a.nested).not.toBe(b.nested);
});

it('room ack broadcasts snapshot requests and responses per recipient', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  await first.serverSocket.join('room');
  await second.serverSocket.join('room');
  const source = { nested: { count: 1 } };
  const outgoing: number[] = [];
  const received: Array<typeof source> = [];
  first.serverSocket.onAnyOutgoing((_event, payload) => {
    const value = payload as typeof source;
    outgoing.push(value.nested.count);
    value.nested.count = 2;
  });
  second.serverSocket.onAnyOutgoing((_event, payload) => {
    const value = payload as typeof source;
    outgoing.push(value.nested.count);
    value.nested.count = 3;
  });
  for (const [index, { client }] of [first, second].entries()) {
    client.on('question', (payload: typeof source, ack: (response: unknown) => void) => {
      received.push(payload);
      const response = { id: index, nested: { count: 1 } };
      ack(response);
      response.nested.count = 2;
    });
  }

  let sourceCountAfterEmit: number | undefined;
  const result = await new Promise<{ err: unknown; responses: unknown[] }>((resolve) => {
    ctx.io
      .to('room')
      .timeout(200)
      .emit('question', source, (err: unknown, responses: unknown[]) =>
        resolve({ err, responses }),
      );
    sourceCountAfterEmit = source.nested.count;
    source.nested.count = 4;
  });

  expect(result.err).toBeNull();
  expect(outgoing).toEqual([1, 2]);
  expect(sourceCountAfterEmit).toBe(3);
  expect(received).toHaveLength(2);
  expect(received[0]).toEqual({ nested: { count: 1 } });
  expect(received[1]).toEqual({ nested: { count: 1 } });
  expect(received[0]).not.toBe(received[1]);
  expect(received[0]?.nested).not.toBe(received[1]?.nested);
  expect(
    (result.responses as Array<{ id: number; nested: { count: number } }>).sort(
      (a, b) => a.id - b.id,
    ),
  ).toEqual([
    { id: 0, nested: { count: 1 } },
    { id: 1, nested: { count: 1 } },
  ]);
});

it('toJSON and enumerable own properties determine decoded object results', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const error = Object.assign(new Error('hidden message'), { code: 'E_PAYLOAD' });
  const received = receive(client, 'payload');

  serverSocket.emit('payload', {
    custom: { toJSON: () => ({ converted: true }) },
    map: new Map([['key', 'value']]),
    set: new Set(['value']),
    regexp: /value/u,
    error,
  });

  await expect(received).resolves.toEqual({
    custom: { converted: true },
    map: {},
    set: {},
    regexp: {},
    error: { code: 'E_PAYLOAD' },
  });
});

it('a plain toJSON result keeps an original binary property out of the packet', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const received = receive(client, 'payload');
  const source = {
    binary: new Uint8Array([1]),
    toJSON: () => ({ converted: true }),
  };

  serverSocket.emit('payload', source);

  await expect(received).resolves.toEqual({ converted: true });
  await expect(received).resolves.not.toBe(source);
});

it('a broadcast encodes even when its room has no recipients', async () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  expect(() => ctx.io.to('empty').emit('payload', circular)).toThrow();
});

it('circular and BigInt payloads fail before delivery in both directions', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const serverBad = track(client, 'server-bad');
  const clientBad = { received: false };
  serverSocket.on('client-bad', () => {
    clientBad.received = true;
  });
  const circular: { self?: unknown } = {};
  circular.self = circular;

  expect(() => serverSocket.emit('server-bad', circular)).toThrow();
  expect(() => client.emit('client-bad', 1n)).toThrow();

  const clientMarker = receive(client, 'client-marker');
  const serverMarker = new Promise<void>((resolve) => serverSocket.once('server-marker', resolve));
  serverSocket.emit('client-marker', 'done');
  client.emit('server-marker', 'done');
  await Promise.all([clientMarker, serverMarker]);
  expect(serverBad.received).toBe(false);
  expect(clientBad.received).toBe(false);
});

it('timeout and connected volatile wrappers use the same payload boundary', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let requestSeen: unknown;
  client.on('question', (payload: unknown, ack: (response: unknown) => void) => {
    requestSeen = payload;
    ack({ date: new Date('2026-08-12T06:00:00.000Z') });
  });
  const volatilePayload = receive(client, 'volatile-payload');
  const clientVolatilePayload = new Promise<unknown>((resolve) =>
    serverSocket.once('client-volatile-payload', resolve),
  );

  const answer = await serverSocket
    .timeout(200)
    .emitWithAck('question', { date: new Date('2026-08-12T05:00:00.000Z') });
  serverSocket.volatile.emit('volatile-payload', {
    date: new Date('2026-08-12T07:00:00.000Z'),
  });
  client.volatile.emit('client-volatile-payload', {
    date: new Date('2026-08-12T08:00:00.000Z'),
  });

  expect(requestSeen).toEqual({ date: '2026-08-12T05:00:00.000Z' });
  expect(answer).toEqual({ date: '2026-08-12T06:00:00.000Z' });
  await expect(volatilePayload).resolves.toEqual({ date: '2026-08-12T07:00:00.000Z' });
  await expect(clientVolatilePayload).resolves.toEqual({
    date: '2026-08-12T08:00:00.000Z',
  });
});
