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

/**
 * A pending connection waiting to be handed to `nextConnection`, or a
 * `nextConnection` call waiting for the next connection. `connect` and
 * `nextConnection` meet through two queues so either can arrive first: the
 * `connectClient` path connects before it awaits `nextConnection`, while a
 * reconnect awaits `nextConnection` before it calls `connect`.
 */
export interface Waiter {
  resolve(socket: ServerSocket): void;
  reject(error: Error): void;
}

/**
 * One namespace: the `adapter` + `sockets` pair the delivery formula reads, plus
 * the connection queues that pair a `connect` with its `nextConnection`. Making
 * these per-namespace is the whole of isolation (#44) — a `BroadcastOperator`
 * built here can only ever see this namespace's sockets and rooms, so a room name
 * collides harmlessly across namespaces and no broadcast crosses a namespace
 * boundary. The delivery formula itself is untouched; only the two data
 * structures it reads are now one set per namespace.
 *
 * Its broadcast surface (`emit`/`to`/`in`/`except`) is the same code that used to
 * live on `Server`, moved here so the server can delegate to `of('/')`.
 */
export class Namespace extends NodeEmitter implements NamespaceContract {
  /**
   * sid -> connected server socket, the adapter's partner: the adapter routes a
   * broadcast to a set of sids and this turns each sid back into a socket to
   * deliver to.
   */
  readonly sockets = new Map<string, ServerSocket>();
  /**
   * This namespace's routing seam: the built-in `Adapter`, or the custom instance
   * installed during server setup through `Server.adapter`.
   */
  adapter: SmocketAdapter;
  /** Server sockets connected here but not yet claimed by a `nextConnection`. */
  private readonly ready: ServerSocket[] = [];
  /**
   * Connection middleware registered through `use`, in registration order. Each runs
   * for every incoming connection here, before the socket is considered connected;
   * the first to reject stops the chain (see `runMiddleware`).
   */
  private readonly middleware: ConnectionMiddleware[] = [];
  /**
   * `nextConnection` calls on this namespace still waiting for a socket. Keeping
   * the queue per-namespace is the subtle half of isolation: a global queue could
   * hand a `nextConnection('/game')` a socket that connected on `/`.
   */
  private readonly waiters: Waiter[] = [];
  /** Once closed, no pending or later pairing may enter this namespace. */
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

  /** Install the adapter instance prepared for this namespace during server setup. */
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

  /**
   * Attach a new client to this namespace in memory and return the client side.
   * The `Server` lookup has already selected the client's Manager identity. The
   * actual pairing is `pair`, shared with reconnect. `source` carries the caller's
   * `auth` / `query` onto the handshake; a reconnect replays the client's own copy.
   */
  connect(manager: Manager, source?: ConnectOptions): ClientSocket {
    const client = new ClientSocket(manager, this, source);
    this.pair(client, source);
    return client;
  }

  /**
   * Pair `client` to a fresh server socket on this namespace. Shared by the first
   * `connect` and by a reconnect (`ClientSocket.connect`): both are the same
   * operation, "give this client a new server socket here", so a reconnect is one
   * call to this rather than a second copy of the connect path. The client comes
   * back not-yet-connected (`connected === false`, `id` undefined); a tick later
   * (decision 3-4b) the new socket is registered, auto-joins its id-room, is
   * offered to `nextConnection`, and the client's `connect` fires, the server
   * side observable before the client side, the order real socket.io uses. `source`
   * is the caller's `auth` / `query`, folded into this socket's handshake (0006).
   */
  pair(client: ClientSocket, source?: ConnectOptions): void {
    const attempt = client.beginConnectionAttempt();
    if (!attempt) return;
    this.continuePair(client, attempt, source);
  }

  /** Continue an attempt whose dynamic parent already resolved admission auth. */
  continuePair(client: ClientSocket, attempt: ConnectionAttempt, source?: ConnectOptions): void {
    if (this.rejectIfClosed(client, attempt)) return;
    // Resolve the auth first, then pair. For an object auth this runs synchronously, so
    // the timing is unchanged; a function auth may call back later, and the connection
    // is held until it does (real socket.io holds the connect until the callback fires).
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

      // Connection middleware runs here, after the handshake is built (so a middleware
      // reads the same fields a `connection` handler will) and before the socket is
      // considered connected. Its verdict gates the deferred completion below: on
      // rejection the socket is dropped before it is registered, joins its id-room, or
      // reaches `connection`, and the client learns of the failure through
      // `connect_error`; a reconnect re-runs `pair`, so the chain runs again for free.
      this.runMiddleware(serverSocket, (err) => {
        if (err) {
          client.rejectConnectionAttempt(attempt, err);
          return;
        }
        if (!client.isConnectionAttemptPending(attempt)) {
          if (attempt.state !== 'connected') serverSocket.cleanupConnectionAttempt();
          return;
        }
        if (this.rejectIfClosed(client, attempt)) return;
        defer(() => {
          if (!client.isConnectionAttemptPending(attempt)) {
            // A middleware can invoke `next` more than once. Once this attempt has
            // connected, a later completion is only a duplicate and must not clean the
            // live socket; cancelled and rejected attempts do need idempotent cleanup.
            if (attempt.state !== 'connected') serverSocket.cleanupConnectionAttempt();
            return;
          }
          if (this.rejectIfClosed(client, attempt)) return;
          // Register the socket before offering it, so a broadcast triggered from a
          // `connection` handler can already resolve this sid to its socket.
          this.sockets.set(serverSocket.id, serverSocket);
          // Auto-join the room named after the socket's own id, exactly as real
          // socket.io does on connect. Reusing `join` carries the adapter update in
          // both directions and the `socket.rooms` mirror. This id-room is what makes
          // `io.to(socketId)` address a single socket and what sender exclusion
          // subtracts (see `BroadcastOperator`). A reconnect gets a fresh id-room and
          // none of the socket's previous rooms, which is the reconnect test's point.
          serverSocket.join(serverSocket.id);
          serverSocket.markConnected();
          this.offer(serverSocket);
          // Fire `connection` before the client's own `connect` (in
          // `completeConnection`), so the server side is observable first, the order
          // real socket.io uses. A handler here can already broadcast to the new
          // socket: it is registered in `sockets` and its id-room above.
          this.emitConnection(serverSocket);
          client.completeConnectionAttempt(attempt, serverSocket);
        });
      });
    });
  }

  /** Reject a connection at whichever async boundary observes that close has started. */
  private rejectIfClosed(client: ClientSocket, attempt: ConnectionAttempt): boolean {
    if (!this.closed) return false;
    client.rejectConnectionAttempt(attempt, new Error('server is closed'));
    return true;
  }

  /**
   * Register a connection middleware, matching real socket.io's `namespace.use`.
   * Middleware are kept in registration order and run by `runMiddleware` on every
   * connection here.
   */
  use(middleware: ConnectionMiddleware): this {
    this.middleware.push(middleware);
    return this;
  }

  /**
   * Run the middleware chain for `socket`, then call `done` once with the verdict:
   * `undefined` to admit the connection, or the rejecting error. Each middleware calls
   * `next` to advance, or `next(err)` to reject and short-circuit the rest. A chain with
   * no middleware admits immediately. This is a plain re-drive with no guard against a
   * middleware calling `next` more than once: like real socket.io, a second `next` just
   * re-drives the chain rather than throwing.
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

  /**
   * Fire the connection handlers with the freshly paired server socket. Both synonyms
   * are raised, `connection` then `connect`, each from its own registry, so a handler
   * on either runs once and the reference order matches real socket.io.
   */
  private emitConnection(socket: ServerSocket): void {
    for (const event of ['connection', 'connect']) {
      this.emitLocal(event, [socket]);
    }
  }

  /** Raise one namespace-reserved event without entering the broadcast path. */
  emitReserved(event: OrdinaryEventName, ...args: unknown[]): void {
    this.emitLocal(event, args);
  }

  /** Resolve with the server socket of the next client to connect here. */
  nextConnection(): Promise<ServerSocket> {
    const socket = this.ready.shift();
    if (socket) return Promise.resolve(socket);
    return new Promise<ServerSocket>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** Hand a freshly connected server socket to a waiter, or park it as ready. */
  private offer(serverSocket: ServerSocket): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(serverSocket);
    } else {
      this.ready.push(serverSocket);
    }
  }

  /** Close every socket, reject observers, and discard unclaimed connections. */
  async close(): Promise<void> {
    this.closed = true;
    this.ready.length = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(serverClosedError());
    await Promise.all([...this.sockets.values()].map((socket) => socket.closeFromServer()));
  }

  emit(event: string, ...args: unknown[]): boolean {
    // No target rooms (everyone) and no exclusion: reaches every socket here.
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
    // `in` is a pure alias of `to` in socket.io; delegate so they cannot drift.
    return this.to(room);
  }
  except(room: string | string[]): BroadcastContract {
    // No target rooms (everyone) minus the members of `room`. No sender to exclude:
    // this is the namespace, not a socket.
    return new BroadcastOperator(this.adapter, this.sockets, [], asRooms(room));
  }
  get volatile(): BroadcastContract {
    // Everyone here, flagged volatile: a per-recipient pre-connect drop, a plain
    // broadcast otherwise (0016). `to`/`except` chain off it and keep the flag.
    return new BroadcastOperator(this.adapter, this.sockets, [], [], true);
  }
  timeout(ms: number): TimeoutBroadcastContract {
    // Everyone here, carrying an ack timeout: `io.of(ns).timeout(ms).to(room).emit(cb)`
    // collects each recipient's ack (#112). `to` chains off it and keeps the timeout.
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
