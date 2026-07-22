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

/** The socket.io `Server`, as `ctx.io`. */
export interface ServerContract {
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
