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
 * covers the connect / disconnect lifecycle and id pairing (#1 / #40) only.
 * Everything downstream of a live connection (emit and acks #41, rooms #42,
 * broadcast #43, namespaces #44, membership cleanup #45) is a `notImplemented`
 * seam so mock mode fails legibly, one message per unfinished feature, instead
 * of on a mystery `undefined`.
 */

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
   * paired server socket is created synchronously and offered to
   * `nextConnection`; the caller gets the server socket back from there, never
   * from a fresh connection, so the two never race.
   */
  connect(_namespace = '/'): ClientSocket {
    const id = newId();
    const serverSocket = new ServerSocket(id);
    const client = new ClientSocket(id, this, serverSocket);

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(serverSocket);
    } else {
      this.ready.push(serverSocket);
    }
    return client;
  }

  /** Resolve with the server socket of the next client to connect. */
  nextConnection(_namespace = '/'): Promise<ServerSocket> {
    const socket = this.ready.shift();
    if (socket) return Promise.resolve(socket);
    return new Promise<ServerSocket>((resolve) => this.waiters.push(resolve));
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

export class ServerSocket implements ServerSocketContract {
  readonly id: string;
  readonly rooms = new Set<string>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(id: string) {
    this.id = id;
  }

  /** Run the server-side teardown for a disconnecting client. */
  handleDisconnect(): void {
    emit(this.listeners, 'disconnecting');
    emit(this.listeners, 'disconnect');
  }

  on(event: string, listener: Listener): void {
    addListener(this.listeners, event, listener);
  }
  once(event: string, listener: Listener): void {
    addOnce(this.listeners, event, listener);
  }
  get nsp(): NamespaceContract {
    return notImplemented('socket.nsp');
  }
  get broadcast(): BroadcastContract {
    return notImplemented('socket.broadcast');
  }
  emit(_event: string, ..._args: unknown[]): void {
    notImplemented('socket.emit()');
  }
  emitWithAck(_event: string, ..._args: unknown[]): Promise<unknown> {
    return notImplemented('socket.emitWithAck()');
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

export class ClientSocket implements ClientSocketContract {
  connected = false;
  id: string | undefined;
  /** The shared Manager stand-in; compared only by identity across namespaces. */
  readonly io: unknown;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    id: string,
    server: Server,
    private readonly serverSocket: ServerSocket,
  ) {
    this.io = server;
    this.id = id;
    this.connected = true;
  }

  on(event: string, listener: Listener): void {
    addListener(this.listeners, event, listener);
  }
  once(event: string, listener: Listener): void {
    addOnce(this.listeners, event, listener);
  }
  emit(_event: string, ..._args: unknown[]): void {
    notImplemented('client.emit()');
  }
  emitWithAck(_event: string, ..._args: unknown[]): Promise<unknown> {
    return notImplemented('client.emitWithAck()');
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

function addListener(map: Map<string, Set<Listener>>, event: string, listener: Listener): void {
  const set = map.get(event) ?? new Set<Listener>();
  set.add(listener);
  map.set(event, set);
}

function addOnce(map: Map<string, Set<Listener>>, event: string, listener: Listener): void {
  const wrapper = ((...args: never[]) => {
    map.get(event)?.delete(wrapper);
    listener(...args);
  }) as Listener;
  addListener(map, event, wrapper);
}

function emit(map: Map<string, Set<Listener>>, event: string, ...args: never[]): void {
  const set = map.get(event);
  if (!set) return;
  for (const listener of [...set]) listener(...args);
}
