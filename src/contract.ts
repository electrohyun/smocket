import type { Server, Socket as IoServerSocket } from 'socket.io';
import type { Socket as IoClientSocket } from 'socket.io-client';

/**
 * The slice of the socket.io / socket.io-client API that the test suite actually
 * touches. This is the shared contract the tests are written against: `real`
 * mode fills it with genuine socket.io objects, `mock` mode with smocket's. The
 * tests import nothing from socket.io directly, so both engines are held to the
 * exact same surface, no more and no less.
 *
 * Everything here is a hand-picked subset (decision (c)). The `Ensure<>` checks
 * at the bottom prove socket.io itself still satisfies each contract, so the
 * subset can never claim a member or shape that the real library lacks.
 *
 * Methods are declared with method syntax on purpose: it keeps their parameters
 * bivariant, which is what lets a loosely-typed contract (`...args: unknown[]`)
 * stay assignable from socket.io's precisely-generic signatures.
 */

/**
 * An event listener. Its parameters are `never[]` so callbacks of any argument
 * shape are accepted; parameters are contravariant, so a `never` slot admits a
 * `string`, a `number`, an ack function, anything. This mirrors socket.io's
 * `(...args: any[])` listeners without the `any` the lint config forbids. (In
 * `emit` the args go the other way (values passed in), so those stay
 * `unknown[]`, which a caller's concrete arguments satisfy.)
 */
type Listener = (...args: never[]) => void;

/**
 * Result of `io.to()` / `socket.broadcast` / `socket.to()` and friends. Every way of
 * narrowing a broadcast lives on the operator itself, not only on the entry points, so
 * `to` / `in` / `except` / `timeout` compose in any order (#137).
 */
export interface BroadcastContract {
  emit(event: string, ...args: unknown[]): boolean;
  to(room: string | string[]): BroadcastContract;
  /** An alias of `to`, as at the entry points. */
  in(room: string | string[]): BroadcastContract;
  /** Exclude a room from this broadcast, on top of any exclusion it already carries. */
  except(room: string | string[]): BroadcastContract;
  /** Add an ack timeout to this broadcast; see {@link TimeoutBroadcastContract}. */
  timeout(ms: number): TimeoutBroadcastContract;
}

/**
 * Result of `socket.timeout(ms)`: a per-emit wrapper that arms a timer on the next
 * acknowledged emit rather than mutating the socket (measured against real socket.io).
 * Its `emit`'s trailing callback is error-first: `(null, response)` when the ack wins
 * the race, and a lone `Error('operation has timed out')` when the timer wins, with a
 * late ack then dropped so the callback fires exactly once. A callback-less `emit` is a
 * plain emit that arms no timer. `emitWithAck` is the same race as a promise, resolving
 * with the response and rejecting with that same timeout `Error`.
 *
 * This is the client side of `timeout(ms)`, where the emit returns the socket so the call
 * chains. The server side returns `true` instead and is {@link SocketTimeoutContract};
 * the two used to share this interface, which stopped working once the return types were
 * measured rather than left as `void`.
 */
export interface TimeoutEmitterContract {
  emit(event: string, ...args: unknown[]): this;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * A broadcast carrying an ack timeout, from `io.timeout(ms)` / `socket.timeout(ms).to(...)`
 * / `socket.broadcast.timeout(ms)` and the like. Its `emit`'s trailing callback is invoked
 * once with `(null, responses)` when every recipient acks in time, or `(Error('operation
 * has timed out'), responses)` when the timer wins, where `responses` holds the acks that
 * arrived, in arrival order. A broadcast to no recipient resolves at once as `(null, [])`.
 * A late ack is dropped, so the callback fires exactly once. The narrowing methods chain
 * and keep the timeout, so `io.timeout(ms).to(a).to(b)` targets the union and
 * `io.timeout(ms).to(a).except(b)` collects from the survivors only (#137).
 */
export interface TimeoutBroadcastContract {
  emit(event: string, ...args: unknown[]): boolean;
  to(room: string | string[]): TimeoutBroadcastContract;
  /** An alias of `to`, as at the entry points. */
  in(room: string | string[]): TimeoutBroadcastContract;
  /** Exclude a room from this broadcast, on top of any exclusion it already carries. */
  except(room: string | string[]): TimeoutBroadcastContract;
}

/**
 * What `socket.timeout(ms)` returns on the server side: the single-ack emit forms
 * (see {@link TimeoutEmitterContract}) plus the broadcast entry points, so a timeout set
 * first still reaches `socket.timeout(ms).to(room)` / `.broadcast` / `.except(room)`, each
 * an ack-collecting {@link TimeoutBroadcastContract}. Real socket.io returns the socket
 * itself here, so this is a subset of its surface and the `Ensure<>` guards below hold.
 *
 * It declares the two emit forms rather than extending {@link TimeoutEmitterContract},
 * because the server's timed `emit` returns `true` where the client's returns the socket.
 * An interface cannot narrow an inherited return type to an unrelated one, so the shared
 * parent went away when the two were measured apart.
 */
export interface SocketTimeoutContract {
  emit(event: string, ...args: unknown[]): boolean;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  broadcast: TimeoutBroadcastContract;
  to(room: string | string[]): TimeoutBroadcastContract;
  except(room: string | string[]): TimeoutBroadcastContract;
}

/**
 * The emitter surface `socket.volatile` returns (0016). A volatile emit is delivered
 * exactly like a plain emit once the socket is connected, and dropped when it is sent in
 * the pre-connect window. Real socket.io returns the socket itself here, so this is a
 * subset of the socket's own surface and the `Ensure<>` guards below still hold. It keeps
 * the broadcast forms so `socket.volatile.broadcast.emit(...)` and `socket.volatile.to(room)`
 * carry the volatile flag through the same routing.
 */
export interface VolatileServerSocket {
  emit(event: string, ...args: unknown[]): boolean;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  broadcast: BroadcastContract;
  to(room: string | string[]): BroadcastContract;
  except(room: string | string[]): BroadcastContract;
}

/** The client-side counterpart of {@link VolatileServerSocket}; a client has no broadcast surface. */
export interface VolatileClientSocket {
  emit(event: string, ...args: unknown[]): this;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
}

/** The room bookkeeping the tests reach into for observation only. */
export interface AdapterContract {
  rooms: Map<string, Set<string>>;
}

/**
 * The error a connection middleware passes to `next` to reject a connection. It is a
 * plain `Error` plus an optional `data`: real socket.io transmits `message` and `data`
 * to the client, which rebuilds an `Error` carrying both, so an app can attach a code
 * or payload to the rejection and read it back on the client's `connect_error`.
 */
export interface MiddlewareError extends Error {
  data?: unknown;
}

/**
 * A connection middleware, registered through `io.use()`. It runs after the handshake
 * is built and before the socket is considered connected: `next()` admits the
 * connection and passes control to the next middleware (or completes it, if last),
 * while `next(err)` rejects it, and the client observes a `connect_error` carrying
 * `err`. A rejected socket never joins its id-room, never enters the roster, and never
 * reaches a `connection` handler. Registration order is execution order, and the first
 * middleware to reject short-circuits the rest.
 */
export type ConnectionMiddleware = (
  socket: ServerSocketContract,
  next: (err?: MiddlewareError) => void,
) => void;

/** A namespace, as returned by `io.of()` and read via `socket.nsp`. */
export interface NamespaceContract {
  name: string;
  adapter: AdapterContract;
  /**
   * Per-namespace entry point: `io.of(name).on('connection', cb)` fires `cb` only
   * for connections on that namespace. `io.on('connection')` is the `/` case of
   * this, so both go through the same surface.
   */
  on(event: string, listener: Listener): this;
  /**
   * Register a connection middleware on this namespace; see {@link ConnectionMiddleware}.
   * Called once per incoming connection here, in registration order.
   */
  use(middleware: ConnectionMiddleware): void;
  emit(event: string, ...args: unknown[]): boolean;
  to(room: string | string[]): BroadcastContract;
  /** A timed broadcast to this namespace; see {@link TimeoutBroadcastContract}. */
  timeout(ms: number): TimeoutBroadcastContract;
  /** Namespace-wide volatile broadcast: `io.of(ns).volatile.emit(...)`; see {@link VolatileServerSocket}. */
  volatile: BroadcastContract;
}

/**
 * The routing seam a custom adapter implements, promoted from smocket's internal
 * `Adapter`. It owns membership (`add` / `del`) and the routing decision
 * (`socketsIn`: which sids a broadcast targets). A routing adapter stops there, so it
 * retargets a broadcast without touching delivery, which stays in the core and keeps the
 * per-socket FIFO invariant (0010) structural. The optional `scheduleDelivery` hook below
 * is the one exception (0018): an adapter that implements it takes over *when* a socket's
 * deliveries fire, so it may delay a stream but owes 0010 the obligation to keep that
 * stream in order (the shipped `DelayingAdapter` does).
 *
 * This is a smocket-only addition with no dual-run counterpart, so it is not held
 * to the `Ensure<>` checks below. Real socket.io's adapter also delivers and needs
 * a transport smocket has none of (0009), so a custom adapter written here does not
 * run there. That asymmetry is recorded in `docs/differences.md` §B.
 */
export interface SmocketAdapter {
  /** room -> member sids. */
  rooms: Map<string, Set<string>>;
  /** sid -> the rooms it is in. */
  sids: Map<string, Set<string>>;
  add(sid: string, room: string): void;
  del(sid: string, room: string): void;
  /** The routing decision: the deduped union of the given rooms' member sids. */
  socketsIn(rooms: Iterable<string>): Set<string>;
  /**
   * Optional delivery-scheduling hook (#78): when present, the core routes a socket's
   * client-inbound event deliveries (server -> client, keyed by `sid`) through it instead of
   * the default next-tick, handing over the `deliver` thunk that runs that socket's
   * `dispatch`. It may delay that stream but must preserve its order (0010): a scheduler that
   * reordered within it would break the FIFO the marker proofs rest on. The server-inbound
   * stream, acknowledgement answers, and the connect / disconnect lifecycle are not routed
   * here; they stay on the next tick. A mock-only affordance with no socket.io counterpart,
   * used by `DelayingAdapter` for race-condition tests; an adapter that omits it keeps the
   * default next-tick delivery.
   */
  scheduleDelivery?(sid: string, deliver: () => void): void;
}

/**
 * Builds the adapter for one namespace. Passed to `Server.adapter` to replace the
 * built-in routing with a custom one; called once per namespace with that
 * namespace, so the adapter can read per-namespace state such as its name.
 */
export type AdapterFactory = (nsp: NamespaceContract) => SmocketAdapter;

/**
 * The clock and scheduler a `DelayingAdapter` uses (#78), the seam for injecting a fake
 * timer so a race-condition test is deterministic and never waits on the wall clock. The
 * default delegates to `setTimeout` / `Date.now`, which Vitest's fake timers already
 * control, so a test opts in with `vi.useFakeTimers()` and drives it with
 * `vi.advanceTimersByTime`, or passes its own implementation.
 */
export interface DeliveryTimer {
  /** Run `fn` `ms` from now. */
  schedule(fn: () => void, ms: number): void;
  /** The current time in ms; used to keep a socket's queue ordered across delay changes. */
  now(): number;
}

/** The socket.io `Server`, as `ctx.io`. */
export interface ServerContract {
  /**
   * The app-facing server entry point: `io.on('connection', cb)` fires `cb` with
   * each new server-side socket, socket.io's primary way to wire per-socket
   * handlers. The `nextConnection` harness path resolves the same socket; this is
   * the on-based path code written for real socket.io actually uses.
   *
   * The return stays `void` while every other `on` in this file narrowed to `this`,
   * because this is the one position where socket.io disagrees with itself. Its
   * declaration says `this`, so the type promises the `Server` back, and at runtime it
   * hands back `io.of('/')`, a `Namespace`. Both chain, so nobody notices, but a contract
   * cannot name a single return that is honest about both. Narrowing to `NamespaceContract`
   * fails the `Ensure<>` proof below, since socket.io's declared `Server` has no `name`,
   * and narrowing to `this` would copy a promise its own runtime does not keep.
   */
  on(event: string, listener: Listener): void;
  /**
   * `io.use` is the default namespace's `use`: it registers a connection middleware for
   * connections on `/`, exactly as `io.of('/').use` would. See {@link ConnectionMiddleware}.
   */
  use(middleware: ConnectionMiddleware): void;
  emit(event: string, ...args: unknown[]): boolean;
  to(room: string | string[]): BroadcastContract;
  in(room: string | string[]): BroadcastContract;
  except(room: string | string[]): BroadcastContract;
  /** A timed broadcast to `/`: `io.timeout(ms).to(room).emit(...)`; see {@link TimeoutBroadcastContract}. */
  timeout(ms: number): TimeoutBroadcastContract;
  /** Server-wide volatile broadcast: `io.volatile.to(room).emit(...)`; see {@link VolatileServerSocket}. */
  volatile: BroadcastContract;
  of(namespace: string): NamespaceContract;
  /** Shut down every namespace and socket. Socket.IO 4.7 returns void; 4.8 returns a promise. */
  close(fn?: (err?: Error) => void): void | Promise<void>;
}

/**
 * `ServerContract` plus the two server members socket.io has no equivalent for, so an
 * application can annotate a smocket server without losing them. `new Server(url)` already
 * carries both; this is the name to write down when that value goes into a typed position.
 *
 * They cannot join `ServerContract` itself. That interface is the subset real socket.io is
 * verified against, and the `Ensure<>` proofs at the bottom of this file stop compiling the
 * moment it names a member socket.io lacks, so widening it would trade the proof for a
 * convenience. The smocket-only surface extends it from outside instead, and deliberately
 * gets no `Ensure<>` line of its own: there is nothing on socket.io's side to prove it
 * against, which is why both members sit in `differences.md` section B.
 */
export interface SmocketServer extends ServerContract {
  /**
   * Replace the routing adapter for every namespace on this server. See
   * [adapter-registration.md](../docs/adapter-registration.md) and {@link AdapterFactory}.
   */
  adapter(factory: AdapterFactory): void;
  /**
   * Resolve with the server-side socket of the next client to connect on `namespace`,
   * which defaults to `/`. Pairs a connect with its server side when the caller drives
   * the connection itself rather than through a helper.
   */
  nextConnection(namespace?: string): Promise<ServerSocketContract>;
}

/**
 * The connection [handshake](../docs/glossary.md#handshake), read as
 * `socket.handshake`. Only the fields a mock has a source for are declared (0006):
 * `auth` and `query` are caller-supplied, `url` is the normalized origin the client
 * connected to, and `time` / `issued` are the pairing timestamp. The network-layer
 * fields (`headers`, `address`, `xdomain`, `secure`) have no source in an in-memory
 * pairing and are left off the surface rather than guessed. The value types are
 * deliberately loose so socket.io's own `Handshake` stays assignable to this subset
 * and the `Ensure<>` guard below holds.
 */
export interface Handshake {
  auth: Record<string, unknown>;
  query: Record<string, unknown>;
  url: string;
  time: string;
  issued: number;
}

/** A server-side socket, as `serverSocket`. */
export interface ServerSocketContract {
  id: string;
  /** Server-only view of room membership; a live Set emptied in place on teardown. */
  rooms: Set<string>;
  nsp: NamespaceContract;
  broadcast: BroadcastContract;
  /** The connection handshake; see {@link Handshake}. */
  handshake: Handshake;
  /**
   * A per-socket store, an empty object at creation (#108). Connection middleware writes
   * to it (`socket.data.userId = ...`) and an event handler reads it back, the place to
   * carry what middleware resolved from the handshake. Server-only, never sent to the
   * client, and tied to the socket: a reconnection is a fresh socket with a fresh `data`.
   */
  data: Record<string, unknown>;
  on(event: string, listener: Listener): this;
  once(event: string, listener: Listener): this;
  /** Remove one registration. The server is Node's emitter, so a listener is required (0017). */
  off(event: string, listener: (...args: unknown[]) => void): this;
  /** Remove every listener for `event`, or all of them when called with no argument. */
  removeAllListeners(event?: string): this;
  /** Catch-all for incoming events; the listener receives the event name then its args. */
  onAny(listener: (...args: unknown[]) => void): this;
  /** Remove one catch-all listener, or all of them when called with no argument. */
  offAny(listener?: (...args: unknown[]) => void): this;
  /** Catch-all for outgoing events this socket sends; receives the event name then its args. */
  onAnyOutgoing(listener: (...args: unknown[]) => void): this;
  /** Remove one outgoing catch-all, or all of them when called with no argument. */
  offAnyOutgoing(listener?: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): boolean;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  /**
   * Arm a per-emit ack timer. Its `emit` / `emitWithAck` are the single-ack forms
   * ({@link TimeoutEmitterContract}); its `to` / `broadcast` / `except` are the
   * ack-collecting broadcast forms ({@link TimeoutBroadcastContract}).
   */
  timeout(ms: number): SocketTimeoutContract;
  /** The volatile emitter (0016): a plain emit once connected, dropped in the pre-connect window. */
  volatile: VolatileServerSocket;
  join(room: string | string[]): Promise<void> | void;
  leave(room: string): Promise<void> | void;
  to(room: string | string[]): BroadcastContract;
  except(room: string | string[]): BroadcastContract;
  /**
   * Server-initiated disconnect. `close` decides whether the underlying transport
   * is closed too; a mock has no transport, so it has no effect there. Fires
   * `disconnect` on both sides with real socket.io's reason for this path.
   */
  disconnect(close?: boolean): void;
}

/** A client-side socket, as `client`. */
export interface ClientSocketContract {
  connected: boolean;
  /** Undefined until connected, matching socket.io-client. */
  id: string | undefined;
  /** The shared Manager; compared only by identity across namespaces. */
  io: unknown;
  on(event: string, listener: Listener): this;
  once(event: string, listener: Listener): this;
  /**
   * The client is component-emitter's: `off()` clears every listener, `off(event)`
   * clears that event, and `off(event, listener)` removes one. No form throws (0017).
   */
  off(event?: string, listener?: (...args: unknown[]) => void): this;
  /** Remove every listener for `event`, or all of them when called with no argument. */
  removeAllListeners(event?: string): this;
  /** Catch-all for incoming events; the listener receives the event name then its args. */
  onAny(listener: (...args: unknown[]) => void): this;
  /** Remove one catch-all listener, or all of them when called with no argument. */
  offAny(listener?: (...args: unknown[]) => void): this;
  /** Catch-all for outgoing events this socket sends; receives the event name then its args. */
  onAnyOutgoing(listener: (...args: unknown[]) => void): this;
  /** Remove one outgoing catch-all, or all of them when called with no argument. */
  offAnyOutgoing(listener?: (...args: unknown[]) => void): this;
  emit(event: string, ...args: unknown[]): this;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  /** Arm a per-emit ack timer on the next emit; see {@link TimeoutEmitterContract}. */
  timeout(ms: number): TimeoutEmitterContract;
  /** The volatile emitter (0016): a plain emit once connected, dropped in the pre-connect window. */
  volatile: VolatileClientSocket;
  connect(): void;
  disconnect(): void;
}

/**
 * A callback-form auth. socket.io-client accepts a function here as well as an object:
 * it is called at connect time and the object it calls back with becomes the handshake
 * auth, so a token can be fetched lazily per connection. The connection is held until
 * the callback fires, and the function is re-evaluated on every reconnect.
 */
export type AuthCallback = (cb: (data: Record<string, unknown>) => void) => void;

/**
 * Options for opening a connection: the caller's `auth` / `query`, carried onto
 * `socket.handshake` (0006). Shared by the public `connect(url, opts)` and the test
 * harness's `connectClient`, so both forward the same fields; `connect` takes the
 * namespace from the url path, so it reads only `auth` and `query`.
 */
export interface ConnectOptions {
  /**
   * Namespace to attach to, `/` by default. Used by the harness `connectClient`;
   * `connect(url)` derives the namespace from the url path and ignores this.
   */
  namespace?: string;
  /**
   * Client-supplied handshake auth, read on the server as `socket.handshake.auth`. An
   * object is carried through as-is; a function is the callback form (see
   * {@link AuthCallback}), resolved at connect time.
   */
  auth?: Record<string, unknown> | AuthCallback;
  /** Client-supplied handshake query, read on the server as `socket.handshake.query`. */
  query?: Record<string, unknown>;
}

export interface ConnectedClient {
  client: ClientSocketContract;
  serverSocket: ServerSocketContract;
}

/**
 * The shape both `setupRealServer` and `setupMockServer` return. Selecting the
 * target is a one-import swap in the test files; nothing else changes.
 */
export interface ServerContext {
  io: ServerContract;
  /** Connect one more client and return it paired with its server-side socket. */
  connectClient: (options?: ConnectOptions) => Promise<ConnectedClient>;
  /**
   * Open a connection and return the client immediately, without waiting for it to
   * connect. Needed for a connection expected to fail (a middleware rejection): its
   * `connect` never fires, so `connectClient` would hang, whereas a test drives this
   * and awaits the client's `connect_error` instead.
   */
  openClient: (options?: ConnectOptions) => ClientSocketContract;
  /**
   * Connect `count` clients and return them paired with their server-side
   * sockets, in connection order. Sugar over `connectClient` for the recurring
   * multi-client setup; connections are made one at a time, since the harness
   * pairs each connect with the next `connection`, so connecting concurrently
   * would mismatch the pairs.
   */
  connectClients: (count: number, options?: ConnectOptions) => Promise<ConnectedClient[]>;
  /**
   * Resolve with the server-side socket of the next client to connect on
   * `namespace`. Needed when the connection is not started by `connectClient`,
   * as with a reconnect of a client already known to the test.
   */
  nextConnection: (namespace?: string) => Promise<ServerSocketContract>;
}

/**
 * Compiles only when `Actual` is assignable to `Contract`. This is the (c)
 * safeguard: if a contract above names a member socket.io lacks, or gets its
 * shape wrong (e.g. `rooms: Map` when it is really a `Set`), the matching line
 * below stops compiling.
 *
 * It is one-directional by design: it proves "everything we require exists on
 * socket.io", not "we required everything socket.io offers". A real member we
 * forgot is the tests' job to surface, not this file's.
 */
type Ensure<Contract, Actual extends Contract> = Actual;

// Socket.io reference types, derived by indexing so no generic arguments (and no
// `any`) are written by hand.
type IoNamespace = ReturnType<Server['of']>;
type IoBroadcast = ReturnType<Server['to']>;
type IoAdapter = IoNamespace['adapter'];

// Exported only so `noUnusedLocals` treats them as used (an unused local type
// alias is TS6196); they are compile-time guards, not meant to be imported.
export type AssertServerContract = Ensure<ServerContract, Server>;
export type AssertServerSocketContract = Ensure<ServerSocketContract, IoServerSocket>;
export type AssertClientSocketContract = Ensure<ClientSocketContract, IoClientSocket>;
export type AssertNamespaceContract = Ensure<NamespaceContract, IoNamespace>;
export type AssertBroadcastContract = Ensure<BroadcastContract, IoBroadcast>;
export type AssertAdapterContract = Ensure<AdapterContract, IoAdapter>;
