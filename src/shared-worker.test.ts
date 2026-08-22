import { afterEach, describe, expect, it } from 'vitest';
import type { ServerSocketContract } from './contract';
import { Server } from './mock-server';
import {
  SHARED_WORKER_MESSAGE_TYPES,
  SHARED_WORKER_PROTOCOL_VERSION,
  attachSharedWorker,
  readSharedWorkerHostMessage,
  readSharedWorkerPageMessage,
  type SharedWorkerHost,
  type SharedWorkerHostMessage,
  type SharedWorkerPageMessage,
} from './shared-worker';

let nextOrigin = 0;
const servers: Server[] = [];
const bridges: PortBridge[] = [];

class PortBridge {
  private readonly workerPort: MessagePort;
  private readonly pagePort: MessagePort;
  private readonly messages: SharedWorkerHostMessage[] = [];
  private readonly waiters: Array<(message: SharedWorkerHostMessage) => void> = [];
  private readonly host: SharedWorkerHost;

  constructor(server: Server) {
    const channel = new MessageChannel();
    this.workerPort = channel.port1;
    this.pagePort = channel.port2;
    this.pagePort.addEventListener('message', (event: MessageEvent<unknown>) => {
      const message = readSharedWorkerHostMessage(event.data);
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.messages.push(message);
    });
    this.pagePort.start();
    this.host = attachSharedWorker(server, this.workerPort);
  }

  post(message: SharedWorkerPageMessage): void {
    this.pagePort.postMessage(message);
  }

  postUnknown(message: unknown): void {
    this.pagePort.postMessage(message);
  }

  reportMessageError(): void {
    this.workerPort.dispatchEvent(new MessageEvent('messageerror'));
  }

  next(): Promise<SharedWorkerHostMessage> {
    const message = this.messages.shift();
    if (message) return Promise.resolve(message);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.host.close('test cleanup');
    this.workerPort.close();
    this.pagePort.close();
  }
}

function setup(): { bridge: PortBridge; io: Server; url: string } {
  const url = `http://shared-worker-${++nextOrigin}.test`;
  const io = new Server(url);
  const bridge = new PortBridge(io);
  servers.push(io);
  bridges.push(bridge);
  return { bridge, io, url };
}

function connectMessage(requestId: string, url: string): SharedWorkerPageMessage {
  return {
    version: SHARED_WORKER_PROTOCOL_VERSION,
    type: SHARED_WORKER_MESSAGE_TYPES.connect,
    requestId,
    url,
    auth: { requestId },
  };
}

function clientEvent(
  generation: number,
  event: string,
  args: unknown[],
  ackId?: string,
): SharedWorkerPageMessage {
  return {
    version: SHARED_WORKER_PROTOCOL_VERSION,
    type: SHARED_WORKER_MESSAGE_TYPES.clientEvent,
    generation,
    event,
    args,
    ...(ackId ? { ackId } : {}),
  };
}

afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('shared-worker protocol', () => {
  it('validates message shape, direction, and protocol version at both boundaries', () => {
    const connect = connectMessage('request:1', 'http://worker.test');
    expect(readSharedWorkerPageMessage(connect)).toEqual(connect);

    expect(() =>
      readSharedWorkerPageMessage({ ...connect, version: SHARED_WORKER_PROTOCOL_VERSION + 1 }),
    ).toThrow('unsupported shared-worker protocol version');
    expect(() => readSharedWorkerPageMessage(null)).toThrow(
      'shared-worker bridge message must be an object',
    );
    expect(() =>
      readSharedWorkerPageMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: 'UNKNOWN',
      }),
    ).toThrow('unknown shared-worker bridge message');
    expect(() => readSharedWorkerPageMessage({ ...connect, auth: [] })).toThrow(
      'CONNECT.auth must be an object',
    );
    expect(() =>
      readSharedWorkerPageMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.clientEvent,
        generation: 0,
        event: 'invalid-generation',
        args: [],
      }),
    ).toThrow('CLIENT_EVENT.generation must be a positive integer');
    expect(() =>
      readSharedWorkerPageMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.clientEvent,
        generation: 1,
        event: 'invalid-args',
        args: 'not-an-array',
      }),
    ).toThrow('CLIENT_EVENT.args must be an array');
    expect(() =>
      readSharedWorkerPageMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.connected,
        requestId: 'request:1',
        generation: 1,
        id: 'socket:1',
      }),
    ).toThrow('unexpected CONNECTED from shared-worker page');
    expect(() =>
      readSharedWorkerHostMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
        generation: 1,
        direction: 'server',
        ackId: 'server:1',
        args: [],
      }),
    ).toThrow('the host may only acknowledge client events');
    expect(() =>
      readSharedWorkerHostMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
        generation: 1,
        direction: 'neither-peer',
        ackId: 'invalid-direction',
        args: [],
      }),
    ).toThrow('ACK.direction must be client or server');
    expect(() =>
      readSharedWorkerPageMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
        generation: 1,
        direction: 'client',
        ackId: 'client:1',
        args: [],
      }),
    ).toThrow('the page may only acknowledge server events');
  });
});

describe('shared-worker host', () => {
  it('connects through the existing server and carries acknowledgements both ways', async () => {
    const { bridge, io, url } = setup();
    const connectedServerSocket = new Promise<ServerSocketContract>((resolve) => {
      io.on('connection', (socket) => {
        socket.on('sum', (left: number, right: number, ack: (value: number) => void) => {
          ack(left + right);
        });
        socket.on('marker', () => socket.emit('marker'));
        resolve(socket);
      });
    });

    bridge.post(connectMessage('request:1', `${url}/?tab=A`));
    const connected = await bridge.next();
    expect(connected).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.connected,
      requestId: 'request:1',
      generation: 1,
    });
    if (connected.type !== SHARED_WORKER_MESSAGE_TYPES.connected) return;
    const serverSocket = await connectedServerSocket;
    expect(connected.id).toBe(serverSocket.id);
    expect(serverSocket.handshake.auth).toEqual({ requestId: 'request:1' });
    expect(serverSocket.handshake.query).toEqual({ tab: 'A' });

    bridge.post(clientEvent(connected.generation, 'sum', [20, 22], 'client:1'));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
      direction: 'client',
      generation: connected.generation,
      ackId: 'client:1',
      args: [42],
    });

    let serverAcknowledgements = 0;
    serverSocket.emit('question', 41, (answer: number) => {
      serverAcknowledgements += 1;
      expect(answer).toBe(42);
    });
    const question = await bridge.next();
    expect(question).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.serverEvent,
      event: 'question',
      args: [41],
    });
    if (question.type !== SHARED_WORKER_MESSAGE_TYPES.serverEvent || !question.ackId) return;
    const answer = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
      generation: connected.generation,
      direction: 'server' as const,
      ackId: question.ackId,
      args: [42],
    };
    bridge.post(answer);
    bridge.post(answer);
    bridge.post(clientEvent(connected.generation, 'marker', []));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.serverEvent,
      event: 'marker',
    });
    expect(serverAcknowledgements).toBe(1);
  });

  it('keeps client events FIFO through an acknowledgement marker', async () => {
    const { bridge, io, url } = setup();
    const seen: string[] = [];
    io.on('connection', (socket) => {
      socket.on('sequence', (value: string, ack?: (values: string[]) => void) => {
        seen.push(value);
        ack?.([...seen]);
      });
    });

    bridge.post(connectMessage('request:1', url));
    const connected = await bridge.next();
    expect(connected.type).toBe(SHARED_WORKER_MESSAGE_TYPES.connected);
    if (connected.type !== SHARED_WORKER_MESSAGE_TYPES.connected) return;
    bridge.post(clientEvent(connected.generation, 'sequence', ['first']));
    bridge.post(clientEvent(connected.generation, 'sequence', ['second']));
    bridge.post(clientEvent(connected.generation, 'sequence', ['marker'], 'client:marker'));

    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
      ackId: 'client:marker',
      args: [['first', 'second', 'marker']],
    });
    expect(seen).toEqual(['first', 'second', 'marker']);
  });

  it('ends the old generation and suppresses its late events and acknowledgements', async () => {
    const { bridge, io, url } = setup();
    const sockets: ServerSocketContract[] = [];
    let staleDeliveries = 0;
    let answerHeldClientEvent: ((value: string) => void) | undefined;
    io.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('hold-client-ack', (ack: (value: string) => void) => {
        answerHeldClientEvent = ack;
        socket.emit('held-marker');
      });
      socket.on('stale-event', () => {
        staleDeliveries += 1;
      });
      socket.on('marker', (ack: (count: number) => void) => ack(staleDeliveries));
    });

    bridge.post(connectMessage('request:1', url));
    const first = await bridge.next();
    expect(first.type).toBe(SHARED_WORKER_MESSAGE_TYPES.connected);
    if (first.type !== SHARED_WORKER_MESSAGE_TYPES.connected) return;

    let oldServerAcknowledgements = 0;
    expect(sockets).toHaveLength(1);
    const firstSocket = sockets[0];
    if (!firstSocket) throw new Error('first server socket was not created');
    firstSocket.emit('held-server-event', (value: string) => {
      oldServerAcknowledgements += 1;
      expect(value).toBe('late');
    });
    const heldServerEvent = await bridge.next();
    if (heldServerEvent.type !== SHARED_WORKER_MESSAGE_TYPES.serverEvent || !heldServerEvent.ackId)
      return;

    bridge.post(clientEvent(first.generation, 'hold-client-ack', [], 'old-client-acknowledgement'));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.serverEvent,
      event: 'held-marker',
      generation: first.generation,
    });

    bridge.post(connectMessage('request:2', url));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.disconnected,
      requestId: 'request:1',
      generation: first.generation,
      reason: 'replaced connection',
    });
    const second = await bridge.next();
    expect(second).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.connected,
      requestId: 'request:2',
      generation: first.generation + 1,
    });
    if (second.type !== SHARED_WORKER_MESSAGE_TYPES.connected) return;
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.connected).toBe(false);

    bridge.post({
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
      generation: first.generation,
      direction: 'server',
      ackId: heldServerEvent.ackId,
      args: ['late'],
    });
    if (!answerHeldClientEvent) throw new Error('client acknowledgement was not retained');
    answerHeldClientEvent('late');
    bridge.post(clientEvent(first.generation, 'stale-event', []));
    bridge.post(clientEvent(second.generation, 'marker', [], 'current-marker'));

    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
      generation: second.generation,
      ackId: 'current-marker',
      args: [0],
    });
    expect(staleDeliveries).toBe(0);
    expect(oldServerAcknowledgements).toBe(0);
  });

  it('reports malformed and unexpected messages without stopping the port', async () => {
    const { bridge, url } = setup();
    bridge.postUnknown({
      ...connectMessage('request:bad-version', url),
      version: SHARED_WORKER_PROTOCOL_VERSION + 1,
    });
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: expect.stringContaining('unsupported shared-worker protocol version'),
    });

    bridge.postUnknown({
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.connected,
      requestId: 'request:host-only',
      generation: 1,
      id: 'not-a-page-message',
    });
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: 'unexpected CONNECTED from shared-worker page',
    });

    bridge.reportMessageError();
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: 'shared-worker page message could not be cloned',
    });

    bridge.post(connectMessage('request:valid', url));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.connected,
      requestId: 'request:valid',
    });
  });

  it('reports connection rejection and releases the failed generation', async () => {
    const { bridge, io, url } = setup();
    io.use((_socket, next) => next(new Error('not admitted')));
    bridge.post(connectMessage('request:denied', url));

    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.connectError,
      requestId: 'request:denied',
      generation: 1,
      error: 'not admitted',
    });
    bridge.post(clientEvent(1, 'after-rejection', []));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: 'shared-worker port has no active connection',
    });
  });

  it('disconnects explicitly with the page-supplied reason', async () => {
    const { bridge, io, url } = setup();
    const serverDisconnected = new Promise<string>((resolve) => {
      io.on('connection', (socket) => socket.once('disconnect', resolve));
    });
    bridge.post(connectMessage('request:1', url));
    const connected = await bridge.next();
    expect(connected.type).toBe(SHARED_WORKER_MESSAGE_TYPES.connected);
    if (connected.type !== SHARED_WORKER_MESSAGE_TYPES.connected) return;

    bridge.post({
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.disconnect,
      requestId: 'request:not-owner',
      generation: connected.generation,
      reason: 'must not disconnect',
    });
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: 'disconnect request does not own the active connection',
    });

    bridge.post({
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.disconnect,
      requestId: connected.requestId,
      generation: connected.generation,
      reason: 'page disconnect',
    });
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.disconnected,
      requestId: connected.requestId,
      generation: connected.generation,
      reason: 'page disconnect',
    });
    await expect(serverDisconnected).resolves.toBe('client namespace disconnect');
  });
});
