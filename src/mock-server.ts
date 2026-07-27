import { randomBytes } from 'node:crypto';
import type {
  BroadcastContract,
  ClientSocketContract,
  NamespaceContract,
  ServerContract,
  ServerSocketContract,
} from './contract';

/**
 * An event listener, matching the `Listener` shape the contract's sockets use:
 * `never[]` parameters so callbacks of any argument shape are accepted.
 */
type Listener = (...args: never[]) => void;

/**
 * smocket's in-memory core. No HTTP server, no port, no transport: a client and
 * its server-side socket are paired directly in memory (decision ③). This file
 * covers the connect lifecycle and id pairing (#40) and event delivery with
 * acknowledgements in both directions (#41). Everything further downstream
 * (rooms #42, broadcast #43, namespaces #44, membership cleanup #45) is a
 * `notImplemented` seam so mock mode fails legibly, one message per unfinished
 * feature, instead of on a mystery `undefined`.
 *
 * FIFO invariant: connection completion and every emit are scheduled through the
 * one `defer` primitive, and the microtask queue is itself FIFO, so a socket
 * observes events in send order. The "did NOT receive" marker proofs in the
 * tests depend on this per-socket ordering; broadcast (#43) must preserve it.
 */

/**
 * Schedule `fn` for the next microtask. The single scheduling primitive shared
 * by connection completion (#40 decision 3-4b: connect resolves a tick later,
 * so a `socket.on('connect', ...)` handler is registered in time) and by emit
 * delivery (#41), which keeps connect and the first emits deterministically
 * ordered and every delivery asynchronous like real socket.io.
 */
function defer(fn: () => void): void {
  queueMicrotask(fn);
}

/** socket.io ids are 20-char url-safe base64. Match the shape, not the source. */
function newId(): string {
  return randomBytes(15).toString('base64url');
}

function notImplemented(member: string): never {
  throw new Error(`smocket: ${member} is not implemented yet`);
}

/**
 * A pending connection waiting to be handed to `nextConnection`, or a
 * `nextConnection` call waiting for the next connection. `connect` and
 * `nextConnection` meet through two queues so either can arrive first: the
 * `connectClient` path connects before it awaits `nextConnection`, while a
 * reconnect awaits `nextConnection` before it calls `connect`.
 */
type Waiter = (socket: ServerSocket) => void;

export class Server implements ServerContract {
  /** Server sockets that have connected but not yet been claimed by a caller. */
  private readonly ready: ServerSocket[] = [];
  /** `nextConnection` calls still waiting for a socket to appear. */
  private readonly waiters: Waiter[] = [];

  /**
   * Attach a client to the server in memory and return the client side. The
   * client comes back not-yet-connected (`connected === false`, `id`
   * undefined); a tick later the paired server socket is offered to
   * `nextConnection` and the client's `connect` fires. The server socket is
   * created up front and handed to `nextConnection` from here, never from a
   * fresh connection, so the two never race.
   */
  connect(_namespace = '/'): ClientSocket {
    const id = newId();
    const serverSocket = new ServerSocket(id);
    const client = new ClientSocket(id, this, serverSocket);
    serverSocket.attachPeer(client);

    // Connection completes a tick later (decision 3-4b). Server-side
    // `connection` is offered first, then the client-side `connect` fires, the
    // order real socket.io uses.
    defer(() => {
      this.offer(serverSocket);
      client.completeConnection();
    });
    return client;
  }

  /** Resolve with the server socket of the next client to connect. */
  nextConnection(_namespace = '/'): Promise<ServerSocket> {
    const socket = this.ready.shift();
    if (socket) return Promise.resolve(socket);
    return new Promise<ServerSocket>((resolve) => this.waiters.push(resolve));
  }

  /** Hand a freshly connected server socket to a waiter, or park it as ready. */
  private offer(serverSocket: ServerSocket): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(serverSocket);
    } else {
      this.ready.push(serverSocket);
    }
  }

  emit(_event: string, ..._args: unknown[]): void {
    notImplemented('server.emit()');
  }
  to(_room: string | string[]): BroadcastContract {
    return notImplemented('server.to()');
  }
  in(_room: string | string[]): BroadcastContract {
    return notImplemented('server.in()');
  }
  except(_room: string | string[]): BroadcastContract {
    return notImplemented('server.except()');
  }
  of(_namespace: string): NamespaceContract {
    return notImplemented('server.of()');
  }
}

/**
 * A minimal event target shared by both socket sides: a listener registry, the
 * `on`/`once` the tests register through, and `dispatch`, which fires this
 * side's own listeners. Delivery from the peer goes through `send`, which calls
 * the target's `dispatch` a tick later.
 */
class Emitter {
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): void {
    addListener(this.listeners, event, listener);
  }

  once(event: string, listener: Listener): void {
    const wrapper = ((...args: never[]) => {
      this.listeners.get(event)?.delete(wrapper);
      listener(...args);
    }) as Listener;
    addListener(this.listeners, event, wrapper);
  }

  /** Fire this side's listeners for `event`. Internal; the peer's `send` calls it. */
  dispatch(event: string, args: unknown[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) (listener as (...a: unknown[]) => void)(...args);
  }
}

export class ServerSocket extends Emitter implements ServerSocketContract {
  readonly id: string;
  readonly rooms = new Set<string>();
  private peer!: ClientSocket;

  constructor(id: string) {
    super();
    this.id = id;
  }

  /** Wire the paired client in; called by `Server.connect` before completion. */
  attachPeer(client: ClientSocket): void {
    this.peer = client;
  }

  /** Run the server-side teardown for a disconnecting client. */
  handleDisconnect(): void {
    this.dispatch('disconnecting', []);
    this.dispatch('disconnect', []);
  }

  emit(event: string, ...args: unknown[]): void {
    send(this.peer, event, args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return emitWithAck(this.peer, event, args);
  }

  get nsp(): NamespaceContract {
    return notImplemented('socket.nsp');
  }
  get broadcast(): BroadcastContract {
    return notImplemented('socket.broadcast');
  }
  join(_room: string | string[]): void {
    notImplemented('socket.join()');
  }
  leave(_room: string): void {
    notImplemented('socket.leave()');
  }
  to(_room: string | string[]): BroadcastContract {
    return notImplemented('socket.to()');
  }
  except(_room: string | string[]): BroadcastContract {
    return notImplemented('socket.except()');
  }
}

export class ClientSocket extends Emitter implements ClientSocketContract {
  connected = false;
  id: string | undefined;
  /** The shared Manager stand-in; compared only by identity across namespaces. */
  readonly io: unknown;
  private readonly assignedId: string;
  private readonly serverSocket: ServerSocket;
  /** Emits made before `connect`; flushed in order once connected (like sendBuffer). */
  private sendBuffer: Array<[string, unknown[]]> = [];

  constructor(id: string, server: Server, serverSocket: ServerSocket) {
    super();
    this.assignedId = id;
    this.serverSocket = serverSocket;
    this.io = server;
  }

  /** Server accepted us: adopt the id, fire `connect`, then flush buffered emits. */
  completeConnection(): void {
    this.connected = true;
    this.id = this.assignedId;
    this.dispatch('connect', []);
    const buffered = this.sendBuffer;
    this.sendBuffer = [];
    for (const [event, args] of buffered) send(this.serverSocket, event, args);
  }

  emit(event: string, ...args: unknown[]): void {
    // Before the connection completes, emits are buffered rather than lost, and
    // replayed in order at `completeConnection`, matching socket.io-client.
    if (!this.connected) {
      this.sendBuffer.push([event, args]);
      return;
    }
    send(this.serverSocket, event, args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return emitWithAck(this.serverSocket, event, args);
  }

  connect(): void {
    notImplemented('client.connect()');
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.id = undefined;
    this.serverSocket.handleDisconnect();
  }
}

/**
 * Deliver `event` to `target`'s listeners a tick later. A trailing function
 * argument is the ack: it is replaced with a wrapper the receiver calls to send
 * its answer back, and that answer is itself delivered a tick later, so the ack
 * round-trip is asynchronous in both directions like real socket.io. The
 * wrapper is one-shot: only the receiver's first ack reaches the sender, later
 * calls are dropped, matching real socket.io.
 */
function send(target: Emitter, event: string, args: unknown[]): void {
  const last = args.at(-1);
  const ack = typeof last === 'function' ? (last as (...a: unknown[]) => void) : undefined;
  const data = ack ? args.slice(0, -1) : args;
  let acked = false;
  const finalArgs = ack
    ? [
        ...data,
        (...answer: unknown[]) => {
          if (acked) return;
          acked = true;
          defer(() => ack(...answer));
        },
      ]
    : data;
  defer(() => target.dispatch(event, finalArgs));
}

/**
 * `emitWithAck` sugar over `send`'s trailing-callback ack: attach a callback
 * that resolves the promise with the peer's answer. The single-value resolve
 * shape is what the conformance suite pins against real socket.io.
 */
function emitWithAck(target: Emitter, event: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve) => {
    send(target, event, [...args, (...answer: unknown[]) => resolve(answer[0])]);
  });
}

function addListener(map: Map<string, Set<Listener>>, event: string, listener: Listener): void {
  const set = map.get(event) ?? new Set<Listener>();
  set.add(listener);
  map.set(event, set);
}
