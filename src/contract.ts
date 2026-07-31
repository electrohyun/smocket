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

/** Result of `io.to()` / `socket.broadcast` / `socket.to()` and friends. */
export interface BroadcastContract {
  emit(event: string, ...args: unknown[]): void;
  to(room: string | string[]): BroadcastContract;
}

/** The room bookkeeping the tests reach into for observation only. */
export interface AdapterContract {
  rooms: Map<string, Set<string>>;
}

/** A namespace, as returned by `io.of()` and read via `socket.nsp`. */
export interface NamespaceContract {
  name: string;
  adapter: AdapterContract;
  emit(event: string, ...args: unknown[]): void;
  to(room: string | string[]): BroadcastContract;
}

/**
 * The routing seam a custom adapter implements, promoted from smocket's internal
 * `Adapter`. It owns membership (`add` / `del`) and the routing decision
 * (`socketsIn`: which sids a broadcast targets), and nothing else. It has no
 * delivery or scheduling method, so a registered adapter can retarget a broadcast
 * but can never reorder or delay a socket's stream: the per-socket FIFO invariant
 * (0010) is structurally out of its reach because delivery stays in the core.
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
}

/**
 * Builds the adapter for one namespace. Passed to `Server.adapter` to replace the
 * built-in routing with a custom one; called once per namespace with that
 * namespace, so the adapter can read per-namespace state such as its name.
 */
export type AdapterFactory = (nsp: NamespaceContract) => SmocketAdapter;

/** The socket.io `Server`, as `ctx.io`. */
export interface ServerContract {
  /**
   * The app-facing server entry point: `io.on('connection', cb)` fires `cb` with
   * each new server-side socket, socket.io's primary way to wire per-socket
   * handlers. The `nextConnection` harness path resolves the same socket; this is
   * the on-based path code written for real socket.io actually uses.
   */
  on(event: string, listener: Listener): void;
  emit(event: string, ...args: unknown[]): void;
  to(room: string | string[]): BroadcastContract;
  in(room: string | string[]): BroadcastContract;
  except(room: string | string[]): BroadcastContract;
  of(namespace: string): NamespaceContract;
}

/** A server-side socket, as `serverSocket`. */
export interface ServerSocketContract {
  id: string;
  /** Server-only view of room membership; a live Set emptied in place on teardown. */
  rooms: Set<string>;
  nsp: NamespaceContract;
  broadcast: BroadcastContract;
  on(event: string, listener: Listener): void;
  once(event: string, listener: Listener): void;
  emit(event: string, ...args: unknown[]): void;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
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
  on(event: string, listener: Listener): void;
  once(event: string, listener: Listener): void;
  emit(event: string, ...args: unknown[]): void;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  connect(): void;
  disconnect(): void;
}

export interface ConnectOptions {
  /** Namespace to attach to, `/` by default. */
  namespace?: string;
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
