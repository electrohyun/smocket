import { afterEach, describe, expect, it } from 'vitest';
import type { ServerSocketContract } from './contract';
import { Server } from './mock-server';
import {
  SHARED_WORKER_MESSAGE_TYPES,
  SHARED_WORKER_PROTOCOL_VERSION,
  attachSharedWorker,
  connectSharedWorker,
  type SharedWorkerHost,
  type SharedWorkerSocket,
} from './shared-worker';

let nextOrigin = 0;
const harnesses: ClientHarness[] = [];
const servers: Server[] = [];

class PageLifecycleHarness {
  readonly listeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type === 'pagehide') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'pagehide') this.listeners.delete(listener);
  }

  pageHide(): void {
    const listeners = [...this.listeners];
    this.listeners.clear();
    for (const listener of listeners) listener();
  }
}

class ClientHarness {
  readonly socket: SharedWorkerSocket;
  private readonly workerPort: MessagePort;
  private readonly pagePort: MessagePort;
  private readonly host: SharedWorkerHost;

  constructor(server: Server, url: string, auth: Record<string, unknown> = {}) {
    const channel = new MessageChannel();
    this.workerPort = channel.port1;
    this.pagePort = channel.port2;
    this.host = attachSharedWorker(server, this.workerPort);
    this.socket = connectSharedWorker(this.pagePort, { url, auth });
  }

  injectHostMessage(message: unknown): void {
    this.workerPort.postMessage(message);
  }

  reportMessageError(): void {
    this.pagePort.dispatchEvent(new MessageEvent('messageerror'));
  }

  close(): void {
    this.socket.disconnect();
    this.host.close('test cleanup');
    this.workerPort.close();
    this.pagePort.close();
  }
}

function setup(
  configure?: (server: Server) => void,
  auth?: Record<string, unknown>,
): { harness: ClientHarness; io: Server; socket: SharedWorkerSocket; url: string } {
  const url = `http://shared-worker-client-${++nextOrigin}.test`;
  const io = new Server(url);
  configure?.(io);
  const harness = new ClientHarness(io, url, auth);
  servers.push(io);
  harnesses.push(harness);
  return { harness, io, socket: harness.socket, url };
}

function nextEvent(socket: SharedWorkerSocket, event: string): Promise<unknown[]> {
  return new Promise((resolve) => socket.once(event, (...args: unknown[]) => resolve(args)));
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) harness.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('shared-worker client facade', () => {
  it('connects automatically, snapshots auth, buffers emits, and reconnects with a fresh id', async () => {
    const handshakes: Array<Record<string, unknown>> = [];
    const serverSockets: ServerSocketContract[] = [];
    const auth = { label: 'A' };
    const { socket } = setup((io) => {
      io.on('connection', (serverSocket) => {
        handshakes.push(serverSocket.handshake.auth);
        serverSockets.push(serverSocket);
        serverSocket.on('queued', (value: string, acknowledge: (value: string) => void) => {
          acknowledge(`accepted:${value}`);
        });
      });
    }, auth);
    const firstConnect = nextEvent(socket, 'connect');
    const queued = socket.emitWithAck('queued', 'before-connect');
    auth.label = 'mutated-after-post';

    await firstConnect;
    await expect(queued).resolves.toBe('accepted:before-connect');
    expect(handshakes[0]).toEqual({ label: 'A' });
    const firstId = socket.id;
    expect(socket.connected).toBe(true);
    expect(socket.disconnected).toBe(false);

    const localDisconnect = nextEvent(socket, 'disconnect');
    socket.auth = { label: 'B' };
    socket.close();
    await expect(localDisconnect).resolves.toEqual(['io client disconnect']);
    expect(socket.connected).toBe(false);
    expect(socket.id).toBeUndefined();

    const secondConnect = nextEvent(socket, 'connect');
    socket.open();
    await secondConnect;
    expect(socket.id).not.toBe(firstId);
    expect(handshakes[1]).toEqual({ label: 'B' });
    expect(serverSockets).toHaveLength(2);
  });

  it('matches the supported ordinary and incoming catch-all listener behavior', async () => {
    let serverSocket!: ServerSocketContract;
    const { socket } = setup((io) =>
      io.on('connection', (connected) => (serverSocket = connected)),
    );
    await nextEvent(socket, 'connect');

    const seen: string[] = [];
    const duplicate = (value: string): void => {
      seen.push(`duplicate:${value}`);
    };
    const middle = (value: string): void => {
      seen.push(`middle:${value}`);
    };
    const once = (value: string): void => {
      seen.push(`once:${value}`);
    };
    const any = (event: string, value: string): void => {
      seen.push(`any:${event}:${value}`);
    };
    const removedOnce = (): void => {
      seen.push('removed-once');
    };
    socket.on('tick', duplicate).on('tick', middle).on('tick', duplicate).once('tick', once);
    socket.once('removed-once', removedOnce).off('removed-once', removedOnce);
    socket.onAny(any).onAny(any);
    const liveAny = socket.listenersAny();
    socket.offAny(any);
    expect(socket.listenersAny()).toBe(liveAny);
    expect(liveAny).toEqual([any]);
    const live = socket.listeners('tick');
    expect(socket.listeners('tick')).toBe(live);
    socket.off('tick', duplicate);

    const firstMarker = nextEvent(socket, 'marker');
    serverSocket.emit('tick', 'one');
    serverSocket.emit('tick', 'two');
    serverSocket.emit('marker', 'first');
    await firstMarker;
    expect(seen).toEqual([
      'any:tick:one',
      'middle:one',
      'duplicate:one',
      'once:one',
      'any:tick:two',
      'middle:two',
      'duplicate:two',
      'any:marker:first',
    ]);

    socket.removeAllListeners('tick').offAny(any);
    const secondMarker = nextEvent(socket, 'marker');
    serverSocket.emit('tick', 'removed');
    serverSocket.emit('marker', 'second');
    await secondMarker;
    expect(seen).not.toContain('middle:removed');
    expect(seen).not.toContain('removed-once');
    expect(socket.listeners('removed-once')).toEqual([]);
    expect(socket.listenersAny()).toEqual([]);
    expect(socket.listeners('unknown')).not.toBe(socket.listeners('unknown'));

    const repeated: string[] = [];
    const sameListener = (value: string): void => {
      repeated.push(value);
    };
    socket.on('same-listener', sameListener).once('same-listener', sameListener);
    const thirdMarker = nextEvent(socket, 'marker');
    serverSocket.emit('same-listener', 'one');
    serverSocket.emit('same-listener', 'two');
    serverSocket.emit('marker', 'third');
    await thirdMarker;
    expect(repeated).toEqual(['one', 'one', 'two']);

    socket.on('cleared', () => undefined).removeAllListeners();
    expect(socket.listeners('cleared')).toEqual([]);
  });

  it('carries callback, promise, send, and server acknowledgements exactly once', async () => {
    let serverSocket!: ServerSocketContract;
    const messages: unknown[][] = [];
    const { socket } = setup((io) => {
      io.on('connection', (connected) => {
        serverSocket = connected;
        connected.on('sum', (left: number, right: number, acknowledge: (sum: number) => void) => {
          acknowledge(left + right);
          acknowledge(999);
        });
        connected.on('message', (...args: unknown[]) => messages.push(args));
        connected.on('marker', (acknowledge: () => void) => acknowledge());
      });
    });
    await nextEvent(socket, 'connect');

    const callbackAnswers: number[] = [];
    socket.emit('sum', 2, 3, (answer: number) => callbackAnswers.push(answer));
    await expect(socket.emitWithAck('sum', 4, 5)).resolves.toBe(9);
    socket.send('hello', 7);

    const serverAnswers: string[] = [];
    socket.on('question', (value: string, acknowledge: (answer: string) => void) => {
      acknowledge(`answer:${value}`);
      acknowledge('duplicate');
    });
    const serverAcknowledgementMarker = nextEvent(socket, 'server-ack-marker');
    serverSocket.emit('question', 'worker', (answer: string) => {
      serverAnswers.push(answer);
      serverSocket.emit('server-ack-marker');
    });
    await socket.emitWithAck('marker');
    await serverAcknowledgementMarker;

    expect(callbackAnswers).toEqual([5]);
    expect(messages).toEqual([['hello', 7]]);
    expect(serverAnswers).toEqual(['answer:worker']);
  });

  it('drops stale generation traffic and retained acknowledgements before a later marker', async () => {
    let heldAcknowledgement: ((value: string) => void) | undefined;
    let retainedServerAcknowledgement: ((value: string) => void) | undefined;
    let staleServerAcknowledgement = false;
    const serverSockets: ServerSocketContract[] = [];
    const { harness, socket } = setup((io) => {
      io.on('connection', (serverSocket) => {
        serverSockets.push(serverSocket);
        serverSocket.on('hold', (acknowledge: (value: string) => void) => {
          heldAcknowledgement = acknowledge;
          serverSocket.emit('held');
        });
      });
    });
    await nextEvent(socket, 'connect');

    const serverAcknowledgementHeld = new Promise<void>((resolve) => {
      socket.on('hold-server-ack', (acknowledge: (value: string) => void) => {
        retainedServerAcknowledgement = acknowledge;
        resolve();
      });
    });
    serverSockets[0]?.emit('hold-server-ack', () => (staleServerAcknowledgement = true));
    await serverAcknowledgementHeld;

    let staleEvent = false;
    let staleAcknowledgement = false;
    socket.on('stale', () => (staleEvent = true));
    const held = nextEvent(socket, 'held');
    void socket.emitWithAck('hold').then(() => (staleAcknowledgement = true));
    await held;

    socket.disconnect();
    const reconnected = nextEvent(socket, 'connect');
    socket.connect();
    await reconnected;
    expect(serverSockets).toHaveLength(2);

    harness.injectHostMessage({
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.serverEvent,
      generation: 1,
      event: 'stale',
      args: [],
    });
    heldAcknowledgement?.('late answer');
    retainedServerAcknowledgement?.('late answer');
    const marker = nextEvent(socket, 'marker');
    serverSockets[1]?.emit('marker');
    await marker;

    expect(staleEvent).toBe(false);
    expect(staleAcknowledgement).toBe(false);
    expect(staleServerAcknowledgement).toBe(false);
  });

  it('reports invalid and non-cloneable traffic without stopping later delivery', async () => {
    let serverSocket!: ServerSocketContract;
    const { harness, socket } = setup((io) =>
      io.on('connection', (connected) => (serverSocket = connected)),
    );
    await nextEvent(socket, 'connect');

    const errors: string[] = [];
    socket.on('bridge_error', (error: Error) => errors.push(error.message));
    expect(() => socket.emit('disconnect')).toThrow('"disconnect" is a reserved event name');
    await expect(socket.emitWithAck('bridge_error')).rejects.toThrow(
      '"bridge_error" is a reserved event name',
    );
    harness.injectHostMessage({
      version: SHARED_WORKER_PROTOCOL_VERSION + 1,
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: 'wrong version',
    });
    harness.injectHostMessage({
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.connect,
      requestId: 'wrong-direction',
      url: 'http://wrong.test',
      auth: {},
    });
    socket.emit('not-cloneable', () => undefined, 'trailing-value');
    harness.reportMessageError();

    const marker = nextEvent(socket, 'marker');
    serverSocket.emit('marker');
    await marker;
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/^could not clone page message:/);
    expect(errors.slice(1)).toEqual([
      'shared-worker message could not be deserialized',
      'unsupported shared-worker protocol version: 2',
      'unexpected CONNECT from shared-worker host',
    ]);
  });

  it('reports admission failure once and uses current auth on an explicit retry', async () => {
    const { socket } = setup(
      (io) => {
        io.use((serverSocket, next) =>
          next(serverSocket.handshake.auth.allowed ? undefined : new Error('not admitted')),
        );
      },
      { allowed: false },
    );
    const connectErrors: string[] = [];
    socket.on('connect_error', (error: Error) => connectErrors.push(error.message));
    const firstError = nextEvent(socket, 'connect_error');
    await expect(firstError).resolves.toMatchObject([{ message: 'not admitted' }]);
    expect(socket.disconnected).toBe(true);

    socket.auth = { allowed: true };
    const connected = nextEvent(socket, 'connect');
    socket.connect();
    await connected;
    expect(socket.connected).toBe(true);
    expect(connectErrors).toEqual(['not admitted']);
  });

  it('disconnects once on pagehide and releases page lifecycle ownership', async () => {
    const lifecycle = new PageLifecycleHarness();
    const addDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'addEventListener');
    const removeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'removeEventListener');
    Object.defineProperties(globalThis, {
      addEventListener: {
        configurable: true,
        value: lifecycle.addEventListener.bind(lifecycle),
      },
      removeEventListener: {
        configurable: true,
        value: lifecycle.removeEventListener.bind(lifecycle),
      },
    });

    try {
      const disconnected: string[] = [];
      const serverDisconnected: Array<Promise<void>> = [];
      const { socket } = setup((io) => {
        io.on('connection', (serverSocket) => {
          serverDisconnected.push(
            new Promise((resolve) =>
              serverSocket.once('disconnect', () => {
                disconnected.push(serverSocket.id);
                resolve();
              }),
            ),
          );
        });
      });
      await nextEvent(socket, 'connect');
      expect(lifecycle.listeners.size).toBe(1);

      const localDisconnect = nextEvent(socket, 'disconnect');
      lifecycle.pageHide();
      lifecycle.pageHide();
      await expect(localDisconnect).resolves.toEqual(['io client disconnect']);
      await serverDisconnected[0];
      expect(disconnected).toHaveLength(1);
      expect(lifecycle.listeners.size).toBe(0);

      const reconnected = nextEvent(socket, 'connect');
      socket.connect();
      await reconnected;
      expect(lifecycle.listeners.size).toBe(1);
      const secondServerDisconnect = serverDisconnected[1];
      socket.disconnect();
      await secondServerDisconnect;
      expect(disconnected).toHaveLength(2);
      expect(lifecycle.listeners.size).toBe(0);
    } finally {
      if (addDescriptor) Object.defineProperty(globalThis, 'addEventListener', addDescriptor);
      else Reflect.deleteProperty(globalThis, 'addEventListener');
      if (removeDescriptor)
        Object.defineProperty(globalThis, 'removeEventListener', removeDescriptor);
      else Reflect.deleteProperty(globalThis, 'removeEventListener');
    }
  });
});
