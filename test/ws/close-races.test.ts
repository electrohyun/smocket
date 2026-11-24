import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { closed, listening, opened, setupWs } from './setup-ws';
import type { EventSocket, Server } from './setup-ws';

const ctx = setupWs();

interface CloseInfo {
  code: number;
  reason: string;
  wasClean: boolean;
}

function observe(socket: EventSocket) {
  const events: string[] = [];
  const messages: { data: unknown; binary: unknown }[] = [];
  const closes: CloseInfo[] = [];
  const errors: unknown[] = [];
  socket.on('message', (data, binary) => {
    events.push('message');
    messages.push({ data, binary });
  });
  socket.on('error', (error) => errors.push(error));
  const done = new Promise<void>((resolve) => {
    socket.onclose = (event: CloseInfo) => {
      events.push('close');
      closes.push({ code: event.code, reason: event.reason, wasClean: event.wasClean });
      resolve();
    };
  });
  return { socket, events, messages, closes, errors, done };
}

function completion() {
  const calls: unknown[] = [];
  let complete = () => {};
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return {
    calls,
    done,
    callback(error?: Error) {
      calls.push(error);
      complete();
    },
  };
}

function stop(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function expectEnded(observation: ReturnType<typeof observe>, info: CloseInfo) {
  expect(observation.closes).toEqual([info]);
  expect(observation.errors).toEqual([]);
  expect(observation.socket.readyState).toBe(3);
}

const abnormal = { code: 1006, reason: '', wasClean: false };

it.each(['client', 'server'] as const)(
  'keeps each peer close result when the %s closes first',
  async (first) => {
    const { server, client, socket } = await ctx.createEventPair();
    const clientEvents = observe(client);
    const serverEvents = observe(socket);

    if (first === 'client') {
      client.close(1000, 'client');
      socket.close(1001, 'server');
    } else {
      socket.close(1001, 'server');
      client.close(1000, 'client');
    }
    await Promise.all([clientEvents.done, serverEvents.done]);
    await stop(server);

    expectEnded(clientEvents, { code: 1001, reason: 'server', wasClean: true });
    expectEnded(serverEvents, { code: 1000, reason: 'client', wasClean: true });
    expect(server.clients?.size).toBe(0);
  },
);

describe.each(['client', 'server'] as const)('%s close and pending delivery', (side) => {
  async function pair() {
    const { server, client, socket } = await ctx.createEventPair();
    const sender = side === 'client' ? client : socket;
    const peer = side === 'client' ? socket : client;
    return { server, sender, peer, senderEvents: observe(sender), peerEvents: observe(peer) };
  }

  it.each(['close first', 'terminate first'] as const)(
    'handles opposite-side close and terminate with %s',
    async (order) => {
      const { server, sender, peer, senderEvents, peerEvents } = await pair();

      if (order === 'close first') {
        sender.close(1000, 'normal');
        peer.terminate();
      } else {
        peer.terminate();
        sender.close(1000, 'normal');
      }
      await Promise.all([senderEvents.done, peerEvents.done]);
      await stop(server);

      expectEnded(senderEvents, abnormal);
      expectEnded(peerEvents, abnormal);
      expect(server.clients?.size).toBe(0);
    },
  );

  it('reports the queued close to the peer when its sender terminates', async () => {
    const { server, sender, senderEvents, peerEvents } = await pair();

    sender.close(1000, 'normal');
    sender.terminate();
    await Promise.all([senderEvents.done, peerEvents.done]);
    await stop(server);

    expectEnded(senderEvents, abnormal);
    expectEnded(peerEvents, { code: 1000, reason: 'normal', wasClean: true });
    expect(server.clients?.size).toBe(0);
  });

  it.each(['sender', 'receiver'] as const)(
    'completes an accepted send once when the %s terminates',
    async (target) => {
      const { server, sender, peer, senderEvents, peerEvents } = await pair();
      const written = completion();
      const data = Buffer.from('queued');

      sender.send(data, written.callback);
      (target === 'sender' ? sender : peer).terminate();
      await Promise.all([written.done, senderEvents.done, peerEvents.done]);
      await stop(server);

      expect(written.calls).toEqual([null]);
      expect(peerEvents.messages).toEqual(target === 'sender' ? [{ data, binary: true }] : []);
      expect(senderEvents.messages).toEqual([]);
      expectEnded(senderEvents, abnormal);
      expectEnded(peerEvents, abnormal);
      expect(server.clients?.size).toBe(0);
    },
  );

  it('receives the still-open peer send before normal close completes', async () => {
    const { server, sender, peer, senderEvents, peerEvents } = await pair();
    const written = completion();
    const data = Buffer.from('queued');

    sender.close(1000, 'normal');
    peer.send(data, written.callback);
    await Promise.all([written.done, senderEvents.done, peerEvents.done]);
    await stop(server);

    expect(written.calls).toEqual([null]);
    expect(senderEvents.events).toEqual(['message', 'close']);
    expect(senderEvents.messages).toEqual([{ data, binary: true }]);
    expect(peerEvents.messages).toEqual([]);
    expectEnded(senderEvents, { code: 1000, reason: 'normal', wasClean: true });
    expectEnded(peerEvents, { code: 1000, reason: 'normal', wasClean: true });
  });

  it('ends both sockets once when a message handler terminates the closing initiator', async () => {
    const { server, sender, peer, senderEvents, peerEvents } = await pair();
    const written = completion();
    sender.once('message', () => sender.terminate());

    sender.close(1000, 'normal');
    peer.send('queued', written.callback);
    await Promise.all([written.done, senderEvents.done, peerEvents.done]);
    await stop(server);

    expect(written.calls).toEqual([null]);
    expect(senderEvents.events).toEqual(['message', 'close']);
    // A close already buffered by the receiver can still be processed after terminate.
    expect(senderEvents.closes).toHaveLength(1);
    expect([abnormal, { code: 1000, reason: 'normal', wasClean: true }]).toContainEqual(
      senderEvents.closes[0],
    );
    expect(senderEvents.errors).toEqual([]);
    expect(sender.readyState).toBe(3);
    expectEnded(peerEvents, { code: 1000, reason: 'normal', wasClean: true });
  });
});

it('rejects a queued connection when its server shuts down and permits reuse', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(server);
  const accepted: string[] = [];
  server.on('connection', (_socket, request) => accepted.push(request.url ?? ''));
  const client = ctx.createClient(`ws://127.0.0.1:${port}/cancelled`);
  const errors: unknown[] = [];
  client.on('error', (error) => errors.push(error));
  const disconnected = closed(client);

  const stopped = stop(server);
  const [result] = await Promise.all([disconnected, stopped]);

  expect(result).toEqual({ code: 1006, reason: Buffer.alloc(0) });
  expect(errors).toEqual([expect.any(Error)]);
  expect(client.readyState).toBe(3);
  expect(server.address()).toBeNull();

  const replacement = ctx.createServer({ port, host: '127.0.0.1' });
  await listening(replacement);

  const next = ctx.createClient(`ws://127.0.0.1:${port}/marker`);
  await opened(next);

  expect(accepted).toEqual([]);
  expect(next.readyState).toBe(1);
});
