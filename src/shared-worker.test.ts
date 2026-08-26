import { afterEach, describe, expect, it } from 'vitest';
import type { ServerSocketContract } from './contract';
import { Server } from './mock-server';
import { attachSharedWorker, type SharedWorkerHost } from './shared-worker';
import {
  SHARED_WORKER_MESSAGE_TYPES,
  SHARED_WORKER_PROTOCOL_VERSION,
  readSharedWorkerHostMessage,
  readSharedWorkerPageMessage,
  type SharedWorkerHostMessage,
  type SharedWorkerPageMessage,
} from './shared-worker-protocol';

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

  dispatch(message: SharedWorkerPageMessage): void {
    this.workerPort.dispatchEvent(new MessageEvent('message', { data: message }));
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

  closeHost(reason: string): void {
    this.host.close(reason);
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
    expect(() =>
      readSharedWorkerPageMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: '',
      }),
    ).toThrow('.type must be a non-empty string');
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
    expect(() =>
      readSharedWorkerHostMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
        error: 'invalid owner',
        requestId: '',
      }),
    ).toThrow('BRIDGE_ERROR.requestId must be a non-empty string');
    expect(() =>
      readSharedWorkerHostMessage({
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
        error: 'invalid generation',
        generation: 0,
      }),
    ).toThrow('BRIDGE_ERROR.generation must be a positive integer');
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
      ackId: expect.any(String),
    });
    if (question.type !== SHARED_WORKER_MESSAGE_TYPES.serverEvent || !question.ackId) {
      throw new Error('question event did not include an acknowledgement id');
    }
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
    expect(heldServerEvent).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.serverEvent,
      event: 'held-server-event',
      ackId: expect.any(String),
    });
    if (
      heldServerEvent.type !== SHARED_WORKER_MESSAGE_TYPES.serverEvent ||
      !heldServerEvent.ackId
    ) {
      throw new Error('held server event did not include an acknowledgement id');
    }

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

  it('reports host delivery failures and survives an undeliverable report', async () => {
    const url = `http://shared-worker-host-post-${++nextOrigin}.test`;
    const io = new Server(url);
    servers.push(io);
    const listeners = new Map<string, (event: MessageEvent<unknown>) => void>();
    const outbound: SharedWorkerHostMessage[] = [];
    let failedServerEvents = 0;
    let resolveMarker!: () => void;
    const markerDelivered = new Promise<void>((resolve) => {
      resolveMarker = resolve;
    });
    const port = {
      addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => listeners.delete(type),
      start: () => undefined,
      postMessage: (message: SharedWorkerHostMessage) => {
        if (
          message.type === SHARED_WORKER_MESSAGE_TYPES.serverEvent &&
          message.event === 'cannot-deliver'
        ) {
          failedServerEvents += 1;
          throw 'port rejected message';
        }
        if (message.type === SHARED_WORKER_MESSAGE_TYPES.bridgeError && failedServerEvents === 2) {
          throw 'port rejected message';
        }
        outbound.push(message);
        if (
          message.type === SHARED_WORKER_MESSAGE_TYPES.serverEvent &&
          message.event === 'marker'
        ) {
          resolveMarker();
        }
      },
    } as unknown as MessagePort;
    const host = attachSharedWorker(io, port);
    const serverConnection = new Promise<ServerSocketContract>((resolve) => {
      io.on('connection', resolve);
    });

    listeners.get('message')?.(
      new MessageEvent('message', { data: connectMessage('request:1', url) }),
    );
    const serverSocket = await serverConnection;
    serverSocket.emit('cannot-deliver', 'payload', () => undefined);
    serverSocket.emit('cannot-deliver', 'payload-with-undeliverable-report');
    serverSocket.emit('marker');
    await markerDelivered;

    expect(outbound).toContainEqual(
      expect.objectContaining({
        type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
        generation: 1,
        error: expect.stringContaining('could not clone host message: port rejected message'),
      }),
    );
    expect(outbound.at(-1)).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.serverEvent,
      event: 'marker',
    });
    host.close();
  });

  it('releases a connection when its admission result cannot cross the port', async () => {
    const url = `http://shared-worker-connected-post-${++nextOrigin}.test`;
    const io = new Server(url);
    servers.push(io);
    const listeners = new Map<string, (event: MessageEvent<unknown>) => void>();
    const outbound: SharedWorkerHostMessage[] = [];
    const port = {
      addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => listeners.delete(type),
      start: () => undefined,
      postMessage: (message: SharedWorkerHostMessage) => {
        if (message.type === SHARED_WORKER_MESSAGE_TYPES.connected) {
          throw new Error('connected message rejected');
        }
        outbound.push(message);
      },
    } as unknown as MessagePort;
    const host = attachSharedWorker(io, port);
    let resolveServerDisconnect!: (reason: string) => void;
    const serverDisconnected = new Promise<string>((resolve) => {
      resolveServerDisconnect = resolve;
    });
    const serverConnection = new Promise<ServerSocketContract>((resolve) => {
      io.on('connection', (socket) => {
        socket.once('disconnect', resolveServerDisconnect);
        resolve(socket);
      });
    });

    listeners.get('message')?.(
      new MessageEvent('message', { data: connectMessage('request:1', url) }),
    );
    await serverConnection;

    expect(outbound).toContainEqual({
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      requestId: 'request:1',
      generation: 1,
      error: 'could not clone host message: connected message rejected',
    });
    expect(outbound.some((message) => message.type === SHARED_WORKER_MESSAGE_TYPES.connected)).toBe(
      false,
    );
    await expect(serverDisconnected).resolves.toBe('client namespace disconnect');
    host.close();
  });

  it('tolerates a port that cannot carry a bridge error', () => {
    const listeners = new Map<string, (event: MessageEvent<unknown>) => void>();
    const port = {
      addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => listeners.delete(type),
      start: () => undefined,
      postMessage: () => {
        throw new Error('closed port');
      },
    } as unknown as MessagePort;
    const host = attachSharedWorker({} as never, port);

    expect(() => listeners.get('messageerror')?.(new MessageEvent('messageerror'))).not.toThrow();
    host.close();
  });

  it('reports connection rejection and releases the failed generation', async () => {
    const { bridge, io, url } = setup();
    io.use((socket, next) =>
      next(
        socket.handshake.auth.requestId === 'request:denied'
          ? new Error('not admitted')
          : undefined,
      ),
    );
    bridge.post(connectMessage('request:invalid-url', 'http://['));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.connectError,
      requestId: 'request:invalid-url',
      generation: 1,
      error: expect.any(String),
    });

    bridge.post(connectMessage('request:denied', url));

    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.connectError,
      requestId: 'request:denied',
      generation: 2,
      error: 'not admitted',
    });
    bridge.post(clientEvent(2, 'after-rejection', []));
    bridge.post(clientEvent(3, 'future-after-rejection', []));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: 'shared-worker port has no active connection',
    });
    bridge.post(connectMessage('request:accepted', url));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.connected,
      requestId: 'request:accepted',
      generation: 3,
    });
  });

  it('disconnects a generation replaced before its connection callback', () => {
    type SocketListener = (...args: unknown[]) => void;
    const socketListeners = [new Map<string, SocketListener>(), new Map<string, SocketListener>()];
    const anyListeners: Array<SocketListener | undefined> = [];
    const disconnectCalls = [0, 0];
    let retainedClientAcknowledgement: SocketListener | undefined;
    const sockets = socketListeners.map((listeners, index) => ({
      id: `socket:${index + 1}`,
      onAny: (listener: SocketListener) => {
        anyListeners[index] = listener;
      },
      on: (event: string, listener: SocketListener) => {
        listeners.set(event, listener);
      },
      emit: (event: string, ...args: unknown[]) => {
        const acknowledgement = args.at(-1);
        if (event === 'hold-client-ack' && typeof acknowledgement === 'function') {
          retainedClientAcknowledgement = acknowledgement as SocketListener;
        }
        if (event === 'double-client-ack' && typeof acknowledgement === 'function') {
          acknowledgement('first');
          acknowledgement('duplicate');
        }
      },
      disconnect: () => {
        disconnectCalls[index] = (disconnectCalls[index] ?? 0) + 1;
      },
    }));
    let nextSocket = 0;
    const server = {
      connect: () => sockets[nextSocket++],
    };
    let receive!: (event: MessageEvent<unknown>) => void;
    const outbound: SharedWorkerHostMessage[] = [];
    const port = {
      addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => {
        if (type === 'message') receive = listener;
      },
      removeEventListener: () => undefined,
      start: () => undefined,
      postMessage: (message: SharedWorkerHostMessage) => outbound.push(message),
    } as unknown as MessagePort;
    const host = attachSharedWorker(server as never, port);

    receive(
      new MessageEvent('message', {
        data: connectMessage('request:first', 'http://replacement.test'),
      }),
    );
    receive(
      new MessageEvent('message', {
        data: clientEvent(1, 'hold-client-ack', [], 'client:retained'),
      }),
    );
    receive(
      new MessageEvent('message', {
        data: connectMessage('request:second', 'http://replacement.test'),
      }),
    );
    expect(outbound[0]).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.disconnected,
      requestId: 'request:first',
      generation: 1,
      reason: 'replaced connection',
    });
    expect(disconnectCalls[0]).toBe(1);
    retainedClientAcknowledgement?.('late');
    anyListeners[0]?.('late-server-event');
    socketListeners[0]?.get('connect_error')?.(new Error('late connect error'));
    socketListeners[0]?.get('connect')?.();
    expect(disconnectCalls[0]).toBe(2);
    socketListeners[1]?.get('connect')?.();
    expect(outbound.at(-1)).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.connected,
      requestId: 'request:second',
      generation: 2,
    });
    receive(
      new MessageEvent('message', {
        data: clientEvent(2, 'double-client-ack', [], 'client:double'),
      }),
    );
    expect(
      outbound.filter(
        (message) =>
          message.type === SHARED_WORKER_MESSAGE_TYPES.acknowledgement &&
          message.ackId === 'client:double',
      ),
    ).toEqual([
      expect.objectContaining({
        direction: 'client',
        args: ['first'],
      }),
    ]);
    socketListeners[1]?.get('disconnect')?.('transport close');
    expect(outbound.at(-1)).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.disconnected,
      requestId: 'request:second',
      reason: 'transport close',
    });
    host.close();
  });

  it('closes an active host once and preserves its shutdown reason', async () => {
    const { bridge, io, url } = setup();
    const serverDisconnected = new Promise<string>((resolve) => {
      io.on('connection', (socket) => socket.once('disconnect', resolve));
    });
    bridge.post(connectMessage('request:1', url));
    const connected = await bridge.next();
    expect(connected.type).toBe(SHARED_WORKER_MESSAGE_TYPES.connected);

    bridge.closeHost('worker shutdown');
    bridge.closeHost('ignored repeated shutdown');
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.disconnected,
      requestId: 'request:1',
      generation: 1,
      reason: 'worker shutdown',
    });
    await expect(serverDisconnected).resolves.toBe('client namespace disconnect');
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

    bridge.post(clientEvent(connected.generation + 1, 'future-generation', []));
    expect(await bridge.next()).toMatchObject({
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: 'unknown shared-worker connection generation',
    });

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
