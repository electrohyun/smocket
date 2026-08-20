import type {
  BroadcastContract,
  ConnectOptions,
  ConnectionMiddleware,
  MiddlewareError,
  NamespaceContract,
  ParentNspNameMatchFn,
  SmocketAdapter,
  TimeoutBroadcastContract,
} from '../contract';
import { Adapter } from './adapters';
import { BroadcastOperator, ParentBroadcastOperator } from './broadcast';
import { asRooms, buildHandshake, defer, newId, resolveAuth, serverClosedError } from './delivery';
import { NodeEmitter, type Listener, type OrdinaryEventName } from './emitters';
import { Manager } from './manager';
import { ClientSocket, type ConnectionAttempt, ServerSocket } from './sockets';

/** One side of the queue pairing between `connect` and `nextConnection`. */
export interface Waiter {
  resolve(socket: ServerSocket): void;
  reject(error: Error): void;
}

/**
 * Owns the adapter, sockets, connection queues, and broadcast surface for one
 * namespace. Keeping these together prevents room and waiter leakage across
 * namespaces (#44).
 */
export class Namespace extends NodeEmitter implements NamespaceContract {
  /** Resolves the sids selected by this namespace's adapter to live sockets. */
  readonly sockets = new Map<string, ServerSocket>();
  /** This namespace's built-in or custom routing seam. */
  adapter: SmocketAdapter;
  /** Server sockets connected here but not yet claimed by a `nextConnection`. */
  private readonly ready: ServerSocket[] = [];
  /** Connection middleware, in registration order. */
  private readonly middleware: ConnectionMiddleware[] = [];
  /** Pending `nextConnection` calls, scoped here to preserve namespace isolation. */
  private readonly waiters: Waiter[] = [];
  private closed: boolean;

  constructor(
    readonly name: string,
    /** The server's normalized origin, filled into each socket's `handshake.url` (0006). */
    private readonly origin: string,
    closed = false,
  ) {
    super();
    this.closed = closed;
    this.adapter = new Adapter();
  }

  override listeners = ((event: OrdinaryEventName) =>
    super.listeners(event)) as NamespaceContract['listeners'];

  useAdapter(adapter: SmocketAdapter): void {
    this.adapter = adapter;
  }

  /** Copy a dynamic parent's setup once, when this concrete child is created. */
  inherit(
    middleware: readonly ConnectionMiddleware[],
    listeners: ReadonlyMap<OrdinaryEventName, readonly Listener[]>,
  ): void {
    this.middleware.push(...middleware);
    for (const [event, entries] of listeners) {
      for (const listener of entries) this.on(event, listener);
    }
  }

  /** Attach through the Manager already selected by `Server`; reconnect shares `pair`. */
  connect(manager: Manager, source?: ConnectOptions): ClientSocket {
    const client = new ClientSocket(manager, this, source);
    this.pair(client, source);
    return client;
  }

  /**
   * Pair an initial connection or reconnect with a fresh server socket. Completion
   * is deferred, with server admission observable before the client's `connect`
   * (0004, 0014); each attempt gets fresh handshake and id-room state (0006, 0013).
   */
  pair(client: ClientSocket, source?: ConnectOptions): void {
    const attempt = client.beginConnectionAttempt();
    if (!attempt) return;
    defer(() => this.continuePair(client, attempt, source));
  }

  continuePair(client: ClientSocket, attempt: ConnectionAttempt, source?: ConnectOptions): void {
    if (!client.isConnectionAttemptPending(attempt)) return;
    if (this.rejectIfClosed(client, attempt)) return;
    resolveAuth(source?.auth, (auth) => {
      if (!client.isConnectionAttemptPending(attempt)) return;
      if (this.rejectIfClosed(client, attempt)) return;
      const handshake = buildHandshake(this.origin, auth, source?.query);
      const serverSocket = new ServerSocket(newId(), this, handshake);
      serverSocket.attachPeer(client);
      if (!client.attachConnectionAttempt(attempt, serverSocket)) {
        serverSocket.cleanupConnectionAttempt();
        return;
      }

      // Middleware sees the final handshake and gates registration, id-room admission,
      // and lifecycle events; rejection remains an unregistered `connect_error`.
      this.runMiddleware(serverSocket, (err) => {
        // Socket.IO queues every completion independently, so an earlier acceptance
        // reaches the client before a later rejection from the same `next` callback.
        defer(() => {
          if (err) {
            if (client.isConnectionAttemptPending(attempt)) {
              client.rejectConnectionAttempt(attempt, err);
            } else if (client.isConnectionAttemptConnected(attempt, serverSocket)) {
              this.discardReady(serverSocket);
              serverSocket.cleanupConnectionAttempt();
              client.reportRepeatedConnectionError(err);
              serverSocket.closeAfterRepeatedConnectionError();
            }
            return;
          }

          if (client.isConnectionAttemptConnected(attempt, serverSocket)) {
            if (this.closed) {
              serverSocket.cleanupConnectionAttempt();
              return;
            }
            this.sockets.set(serverSocket.id, serverSocket);
            serverSocket.join(serverSocket.id);
            serverSocket.markConnected();
            this.emitConnection(serverSocket);
            client.repeatConnectionCompletion();
            return;
          }

          if (!client.isConnectionAttemptPending(attempt)) {
            if (attempt.state !== 'connected') serverSocket.cleanupConnectionAttempt();
            return;
          }
          if (this.rejectIfClosed(client, attempt)) return;
          // Registration precedes `connection`, so its handlers may broadcast immediately.
          this.sockets.set(serverSocket.id, serverSocket);
          // The fresh id-room enables direct addressing and sender exclusion (0013).
          serverSocket.join(serverSocket.id);
          serverSocket.markConnected();
          this.offer(serverSocket);
          // Server `connection` is observable before the client's `connect` (0014).
          this.emitConnection(serverSocket);
          client.completeConnectionAttempt(attempt, serverSocket);
        });
      });
    });
  }

  private rejectIfClosed(client: ClientSocket, attempt: ConnectionAttempt): boolean {
    if (!this.closed) return false;
    client.rejectConnectionAttempt(attempt, new Error('server is closed'));
    return true;
  }

  use(middleware: ConnectionMiddleware): this {
    this.middleware.push(middleware);
    return this;
  }

  /**
   * Snapshot and re-drive the middleware chain without a duplicate-`next` guard;
   * each completion reports admission or the rejecting error.
   */
  private runMiddleware(socket: ServerSocket, done: (err?: MiddlewareError) => void): void {
    const chain = [...this.middleware];
    let index = 0;
    const next = (err?: MiddlewareError): void => {
      if (err) {
        done(err);
        return;
      }
      const middleware = chain[index];
      index += 1;
      if (!middleware) {
        done();
        return;
      }
      middleware(socket, next);
    };
    next();
  }

  /** Emit both synonyms from separate registries, in `connection` then `connect` order. */
  private emitConnection(socket: ServerSocket): void {
    for (const event of ['connection', 'connect']) {
      this.emitLocal(event, [socket]);
    }
  }

  emitReserved(event: OrdinaryEventName, ...args: unknown[]): void {
    this.emitLocal(event, args);
  }

  nextConnection(): Promise<ServerSocket> {
    const socket = this.ready.shift();
    if (socket) return Promise.resolve(socket);
    return new Promise<ServerSocket>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private offer(serverSocket: ServerSocket): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(serverSocket);
    } else {
      this.ready.push(serverSocket);
    }
  }

  private discardReady(serverSocket: ServerSocket): void {
    const index = this.ready.indexOf(serverSocket);
    if (index !== -1) this.ready.splice(index, 1);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ready.length = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(serverClosedError());
    await Promise.all([...this.sockets.values()].map((socket) => socket.closeFromServer()));
  }

  emit(event: string, ...args: unknown[]): boolean {
    return new BroadcastOperator(this.adapter, this.sockets, [], []).emit(event, ...args);
  }
  send(...args: unknown[]): this {
    this.emit('message', ...args);
    return this;
  }
  write(...args: unknown[]): this {
    return this.send(...args);
  }
  to(room: string | string[]): BroadcastContract {
    return new BroadcastOperator(this.adapter, this.sockets, asRooms(room), []);
  }
  in(room: string | string[]): BroadcastContract {
    return this.to(room);
  }
  except(room: string | string[]): BroadcastContract {
    return new BroadcastOperator(this.adapter, this.sockets, [], asRooms(room));
  }
  get volatile(): BroadcastContract {
    return new BroadcastOperator(this.adapter, this.sockets, [], [], true);
  }
  timeout(ms: number): TimeoutBroadcastContract {
    return new BroadcastOperator(this.adapter, this.sockets, [], [], false, ms);
  }
  compress(_compress: boolean): BroadcastContract {
    return new BroadcastOperator(this.adapter, this.sockets, [], []);
  }
  fetchSockets(): Promise<ServerSocket[]> {
    return new BroadcastOperator(this.adapter, this.sockets, [], []).fetchSockets();
  }
  socketsJoin(room: string | string[]): void {
    new BroadcastOperator(this.adapter, this.sockets, [], []).socketsJoin(room);
  }
  socketsLeave(room: string | string[]): void {
    new BroadcastOperator(this.adapter, this.sockets, [], []).socketsLeave(room);
  }
  disconnectSockets(close = false): void {
    new BroadcastOperator(this.adapter, this.sockets, [], []).disconnectSockets(close);
  }
}

/** A hidden dynamic parent whose public operations fan out over concrete children. */
export class ParentNamespace extends NodeEmitter implements NamespaceContract {
  readonly adapter: SmocketAdapter = new Adapter();
  readonly children = new Set<Namespace>();
  readonly middleware: ConnectionMiddleware[] = [];

  constructor(
    readonly name: string,
    private readonly matcher: RegExp | ParentNspNameMatchFn,
  ) {
    super();
  }

  override listeners = ((event: OrdinaryEventName) =>
    super.listeners(event)) as NamespaceContract['listeners'];

  matches(name: string, auth: Record<string, unknown>, next: (allowed: boolean) => void): void {
    if (this.matcher instanceof RegExp) {
      next(this.matcher.test(name));
      return;
    }
    this.matcher(name, auth, (error, allowed) => next(!error && allowed));
  }

  matchesSynchronously(name: string): boolean {
    if (!(this.matcher instanceof RegExp)) return false;
    return this.matcher.test(name);
  }

  addChild(child: Namespace): void {
    if (this.children.has(child)) return;
    child.inherit(this.middleware, this.snapshotListeners(['connect', 'connection']));
    this.children.add(child);
  }

  use(middleware: ConnectionMiddleware): this {
    this.middleware.push(middleware);
    return this;
  }
  emit(event: string, ...args: unknown[]): boolean {
    return new ParentBroadcastOperator(this.children).emit(event, ...args);
  }
  send(...args: unknown[]): this {
    this.emit('message', ...args);
    return this;
  }
  write(...args: unknown[]): this {
    return this.send(...args);
  }
  to(room: string | string[]): BroadcastContract {
    return new ParentBroadcastOperator(this.children).to(room);
  }
  in(room: string | string[]): BroadcastContract {
    return this.to(room);
  }
  except(room: string | string[]): BroadcastContract {
    return new ParentBroadcastOperator(this.children).except(room);
  }
  timeout(ms: number): TimeoutBroadcastContract {
    return new ParentBroadcastOperator(this.children).timeout(ms);
  }
  compress(_compress: boolean): BroadcastContract {
    return new ParentBroadcastOperator(this.children);
  }
  get volatile(): BroadcastContract {
    return new ParentBroadcastOperator(this.children).volatile;
  }
  fetchSockets(): Promise<ServerSocket[]> {
    throw new Error('fetchSockets() is not supported on parent namespaces');
  }
  socketsJoin(room: string | string[]): void {
    new ParentBroadcastOperator(this.children).socketsJoin(room);
  }
  socketsLeave(room: string | string[]): void {
    new ParentBroadcastOperator(this.children).socketsLeave(room);
  }
  disconnectSockets(close = false): void {
    new ParentBroadcastOperator(this.children).disconnectSockets(close);
  }
}
