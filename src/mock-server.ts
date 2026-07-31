import { randomBytes } from 'node:crypto';
import type {
  AdapterFactory,
  BroadcastContract,
  ClientSocketContract,
  NamespaceContract,
  ServerContract,
  ServerSocketContract,
  SmocketAdapter,
} from './contract';

/**
 * An event listener, matching the `Listener` shape the contract's sockets use:
 * `never[]` parameters so callbacks of any argument shape are accepted.
 */
type Listener = (...args: never[]) => void;

/**
 * smocket's in-memory core. No HTTP server, no port, no transport: a client and
 * its server-side socket are paired directly in memory (decision ③). It is the
 * `mock` half of the dual-run suite, standing in for a real socket.io server and
 * reproducing its behaviour over the surface the conformance tests exercise, from
 * the connect / disconnect lifecycle through emit/on acks, rooms, broadcast, and
 * per-namespace isolation. What must be reproduced is whatever those tests pin;
 * whether it holds is the CI run's verdict, not this comment's.
 *
 * FIFO invariant: connection completion and every emit are scheduled through the
 * one `defer` primitive, and the microtask queue is itself FIFO, so a socket
 * observes events in send order. The "did NOT receive" marker proofs in the
 * tests depend on this per-socket ordering; broadcast must preserve it.
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

/** Normalize socket.io's `one room | many rooms` argument to an array. */
function asRooms(room: string | string[]): string[] {
  return Array.isArray(room) ? room : [room];
}

/**
 * A pending connection waiting to be handed to `nextConnection`, or a
 * `nextConnection` call waiting for the next connection. `connect` and
 * `nextConnection` meet through two queues so either can arrive first: the
 * `connectClient` path connects before it awaits `nextConnection`, while a
 * reconnect awaits `nextConnection` before it calls `connect`.
 */
type Waiter = (socket: ServerSocket) => void;

/**
 * The room bookkeeping for one namespace, reproducing socket.io's per-namespace
 * `socket.io-adapter`. It owns the two mirrored maps and nothing else: it mutates
 * membership and answers "which sids are in these rooms", but never delivers an
 * event. Delivery is the caller's job (see `BroadcastOperator`), which keeps the
 * adapter reusable for observation (`io.of('/').adapter`, #44) without pulling
 * the delivery path into it.
 *
 * The two maps are the same membership read from both directions, kept in step
 * by every mutator:
 * - `rooms`: room name -> the sids currently in it.
 * - `sids`:  sid -> the rooms it currently belongs to.
 *
 * It is the built-in `SmocketAdapter`, and the base a custom one extends: a
 * registered adapter typically overrides `socketsIn` to observe or narrow the
 * routing decision while reusing this membership bookkeeping (see `Server.adapter`).
 */
export class Adapter implements SmocketAdapter {
  /** room -> member sids. A room key exists only while it has at least one member. */
  readonly rooms = new Map<string, Set<string>>();
  /** sid -> the rooms it is in. The reverse index, so leaving is not a full scan. */
  readonly sids = new Map<string, Set<string>>();

  /** Record that `sid` is now in `room`, updating both directions. */
  add(sid: string, room: string): void {
    const members = this.rooms.get(room) ?? new Set<string>();
    members.add(sid);
    this.rooms.set(room, members);

    const joined = this.sids.get(sid) ?? new Set<string>();
    joined.add(room);
    this.sids.set(sid, joined);
  }

  /**
   * Record that `sid` has left `room`. When the room loses its last member the
   * key is dropped, so `rooms` never keeps empty rooms around, matching
   * socket.io-adapter.
   */
  del(sid: string, room: string): void {
    const members = this.rooms.get(room);
    if (members) {
      members.delete(sid);
      if (members.size === 0) this.rooms.delete(room);
    }
    this.sids.get(sid)?.delete(room);
  }

  /**
   * Resolve target rooms to the deduped union of their member sids. A socket in
   * several of the target rooms appears once, which is what stops `io.to(a).to(b)`
   * from delivering twice to a socket in both.
   */
  socketsIn(rooms: Iterable<string>): Set<string> {
    const sids = new Set<string>();
    for (const room of rooms) {
      const members = this.rooms.get(room);
      if (!members) continue;
      for (const sid of members) sids.add(sid);
    }
    return sids;
  }
}

/**
 * The object returned by every broadcast form: `io.emit`, `io.to`/`in`/`except`,
 * `socket.broadcast`, `socket.to`, `socket.except`. All eleven are the same one
 * formula over two sets, so they are all this one operator built with different
 * initial sets (see the `Server` / `ServerSocket` construction sites):
 *
 *   targets  = targetRooms empty ? all connected sids : union(targetRooms)
 *   excluded = union(each exceptRoom's member sids)
 *   deliver to (targets - excluded), once per socket
 *
 * Sender exclusion is not a flag: it is the sender's own id-room dropped into
 * `exceptRooms`. Because every socket auto-joins a room named after its id on
 * connect, `except {ownId}` subtracts exactly the sender. This is why
 * `socket.to(room)` excludes a sender that is itself in `room` for free: the
 * room's union includes the sender (its id-room member is itself), and the
 * `{ownId}` except then removes it.
 *
 * `to` unions in more rooms and returns `this`, so `io.to(a).to(b)` targets the
 * union of both. `except` is a constructor argument only, never chained: the
 * `BroadcastContract` is `{ emit; to }` and no form needs `.to().except()`.
 *
 * `emit` resolves both sets to sids through the adapter, then hands each surviving
 * member to that member's own `ServerSocket.emit`. It deliberately reuses the
 * per-socket send path rather than delivering itself: every event, direct or
 * broadcast, then flows through the one `defer` primitive, so the per-socket FIFO
 * order the "did NOT receive" marker proofs rely on holds for broadcast too.
 */
class BroadcastOperator implements BroadcastContract {
  private readonly targetRooms = new Set<string>();
  private readonly exceptRooms = new Set<string>();

  constructor(
    private readonly adapter: SmocketAdapter,
    private readonly sockets: Map<string, ServerSocket>,
    rooms: Iterable<string>,
    except: Iterable<string>,
  ) {
    for (const room of rooms) this.targetRooms.add(room);
    for (const room of except) this.exceptRooms.add(room);
  }

  to(room: string | string[]): BroadcastContract {
    for (const r of asRooms(room)) this.targetRooms.add(r);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    // Empty target rooms means "everyone" (`io.emit` / `socket.broadcast`), so the
    // target set is all connected sids; otherwise it is the deduped union of the
    // target rooms' members. The excluded set is the union of the except rooms'
    // members (the sender's id-room for the `socket.*` forms). Deliver to the
    // difference, once per socket, through each socket's own send path.
    const targets =
      this.targetRooms.size === 0
        ? new Set(this.sockets.keys())
        : this.adapter.socketsIn(this.targetRooms);
    const excluded = this.adapter.socketsIn(this.exceptRooms);
    for (const sid of targets) {
      if (excluded.has(sid)) continue;
      this.sockets.get(sid)?.emit(event, ...args);
    }
  }
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
class Namespace implements NamespaceContract {
  /**
   * sid -> connected server socket, the adapter's partner: the adapter routes a
   * broadcast to a set of sids and this turns each sid back into a socket to
   * deliver to.
   */
  readonly sockets = new Map<string, ServerSocket>();
  /**
   * This namespace's routing seam: the built-in `Adapter`, or a custom one built by
   * the factory registered through `Server.adapter`. Not `readonly`, so a late
   * `io.adapter()` can swap it in; see `useAdapter`.
   */
  adapter: SmocketAdapter;
  /** Server sockets connected here but not yet claimed by a `nextConnection`. */
  private readonly ready: ServerSocket[] = [];
  /**
   * Handlers registered through `on`, keyed by event. This is the app-facing entry
   * point: `io.on('connection', cb)` wires per-socket handlers, and each is fired
   * with the new server socket as the pairing completes. The `nextConnection`
   * harness path resolves the same socket; the two are the two ways to reach a
   * fresh connection, not two different connections. Kept per-event (not one merged
   * set) so `connection` and its `connect` synonym stay separate registries, matching
   * real socket.io, where a listener on each fires once and the same function on both
   * fires twice.
   */
  private readonly connectionListeners = new Map<string, Set<Listener>>();
  /**
   * `nextConnection` calls on this namespace still waiting for a socket. Keeping
   * the queue per-namespace is the subtle half of isolation: a global queue could
   * hand a `nextConnection('/game')` a socket that connected on `/`.
   */
  private readonly waiters: Waiter[] = [];

  constructor(
    readonly name: string,
    /** The shared Manager stand-in every client here is given; see ClientSocket.io. */
    private readonly server: Server,
    /** The custom adapter factory registered on the server, if any; see `useAdapter`. */
    adapterFactory?: AdapterFactory,
  ) {
    this.adapter = adapterFactory ? adapterFactory(this) : new Adapter();
  }

  /**
   * Swap in a custom adapter built by `factory`. Called by `Server.adapter` both
   * when a namespace is created and to reconfigure one that already exists, so
   * registering an adapter reaches every namespace. Like real socket.io, this
   * installs a fresh adapter and does not carry over membership, so it is meant to
   * be called during setup, before any client connects here.
   */
  useAdapter(factory: AdapterFactory): void {
    this.adapter = factory(this);
  }

  /**
   * Attach a new client to this namespace in memory and return the client side.
   * The client takes the `Server` as its `io`, so two clients on different
   * namespaces share one Manager stand-in, one multiplexed connection. The actual
   * pairing is `pair`, shared with reconnect.
   */
  connect(): ClientSocket {
    const client = new ClientSocket(this.server, this);
    this.pair(client);
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
   * side observable before the client side, the order real socket.io uses.
   */
  pair(client: ClientSocket): void {
    const serverSocket = new ServerSocket(newId(), this);
    serverSocket.attachPeer(client);

    defer(() => {
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
      this.offer(serverSocket);
      // Fire `connection` before the client's own `connect` (in
      // `completeConnection`), so the server side is observable first, the order
      // real socket.io uses. A handler here can already broadcast to the new
      // socket: it is registered in `sockets` and its id-room above.
      this.emitConnection(serverSocket);
      client.completeConnection(serverSocket);
    });
  }

  /**
   * Register a namespace-level handler. Only the connection events have a source in
   * the mock (0000): `connection`, and `connect` as its synonym, are the app entry
   * point that hands over each new server socket. Real socket.io fires both, so an
   * app listening on either works. Other events are accepted but never fire, since a
   * mock has nothing else to raise here.
   */
  on(event: string, listener: Listener): void {
    if (event === 'connection' || event === 'connect') {
      addListener(this.connectionListeners, event, listener);
    }
  }

  /**
   * Fire the connection handlers with the freshly paired server socket. Both synonyms
   * are raised, `connection` then `connect`, each from its own registry, so a handler
   * on either runs once and the reference order matches real socket.io.
   */
  private emitConnection(socket: ServerSocket): void {
    for (const event of ['connection', 'connect']) {
      const set = this.connectionListeners.get(event);
      if (!set) continue;
      for (const listener of [...set]) (listener as (s: ServerSocket) => void)(socket);
    }
  }

  /** Resolve with the server socket of the next client to connect here. */
  nextConnection(): Promise<ServerSocket> {
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

  emit(event: string, ...args: unknown[]): void {
    // No target rooms (everyone) and no exclusion: reaches every socket here.
    new BroadcastOperator(this.adapter, this.sockets, [], []).emit(event, ...args);
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
}

/**
 * The origin registry: normalized origin -> the `Server` listening there. Every
 * `new Server(url)` registers itself here and every `connect(url)` resolves through
 * it, so the required url and this map are the one decision (0003). A module-level
 * singleton, cleared between tests through `resetRegistry`.
 */
const servers = new Map<string, Server>();

/**
 * Split a url into its origin (the registry key) and namespace path, normalizing
 * the way socket.io's `url.js` does so two spellings of one origin collapse to a
 * single key (0003): a relative url resolves against `location.origin`, and a
 * missing port is filled from the scheme (http -> 80, https -> 443).
 */
function parseUrl(url: string): { origin: string; namespace: string } {
  // `location` exists in a browser/jsdom run and is absent under plain node; read
  // it off `globalThis` so the reference type-checks either way.
  const base = (globalThis as { location?: { origin: string } }).location?.origin;
  const parsed = new URL(url, base);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const origin = `${parsed.protocol}//${parsed.hostname}:${port}`;
  const namespace = parsed.pathname === '' ? '/' : parsed.pathname;
  return { origin, namespace };
}

/**
 * Attach a client to the server registered for `url`'s origin: smocket's
 * app-facing entry point, socket.io-client's `io(url)`. The origin is resolved
 * through the registry (0003) and the url's path selects the namespace. When no
 * server is registered for that origin, the returned client fires `connect_error`
 * and does not retry (0005), rather than throwing.
 */
export function connect(url: string): ClientSocketContract {
  const { origin, namespace } = parseUrl(url);
  const server = servers.get(origin);
  if (!server) return new FailedClientSocket(origin);
  return server.connect(namespace);
}

/**
 * Clear the origin registry. Test-only, and deliberately not re-exported from the
 * package index: the registry is a module-level singleton that would otherwise
 * carry servers across a file's tests, so a suite registering servers resets
 * between cases to keep `connect(url)` lookups isolated.
 */
export function resetRegistry(): void {
  servers.clear();
}

export class Server implements ServerContract {
  /** This server's normalized origin, its key in the module `servers` registry. */
  readonly origin: string;
  /**
   * The namespace registry. Every connection, room and broadcast lives on a
   * `Namespace`; the server is the front door that routes to one. `of` is
   * get-or-create and returns the *same* `Namespace` on repeat calls, so the
   * `connect` path and an `of()` observation in a test reach one object.
   */
  private readonly namespaces = new Map<string, Namespace>();

  /**
   * The custom adapter factory registered through `adapter`, applied to every
   * namespace this server creates. Undefined until a caller registers one, in
   * which case each namespace uses the built-in `Adapter`.
   */
  private adapterFactory: AdapterFactory | undefined;

  /**
   * The url is required, with no argument-less form: socket.io always takes a
   * connection target, so smocket does too rather than invent a rule for what an
   * unlabelled server means (0003). The url is normalized to an origin and the
   * server registers itself under it, so a later `connect(url)` naming the same
   * origin resolves back to this instance.
   */
  constructor(url: string) {
    this.origin = parseUrl(url).origin;
    servers.set(this.origin, this);
  }

  /**
   * Register a custom [adapter](../docs/glossary.md#adapter) factory: smocket's
   * public routing seam. The factory builds one adapter per namespace, replacing
   * the built-in routing (which sids a broadcast targets) while delivery stays in
   * the core, so a custom adapter cannot break per-socket order (0010). This is a
   * smocket-only API with no socket.io-compatible counterpart (see
   * `docs/differences.md` §B); call it during setup, before connecting clients,
   * since it installs a fresh adapter on every namespace, including existing ones.
   */
  adapter(factory: AdapterFactory): void {
    this.adapterFactory = factory;
    for (const namespace of this.namespaces.values()) namespace.useAdapter(factory);
  }

  /** Get the namespace by name, creating it on first use (socket.io's lazy `of`). */
  of(name: string): Namespace {
    const existing = this.namespaces.get(name);
    if (existing) return existing;
    const namespace = new Namespace(name, this, this.adapterFactory);
    this.namespaces.set(name, namespace);
    return namespace;
  }

  /**
   * The server's `on` is the default namespace's: `io.on('connection')` is exactly
   * `io.of('/').on('connection')`, socket.io's primary server entry point, so it
   * wires handlers for connections on `/` and never sees another namespace's.
   */
  on(event: string, listener: Listener): void {
    this.of('/').on(event, listener);
  }

  /** Attach a client on `namespace` (`/` by default); see `Namespace.connect`. */
  connect(namespace = '/'): ClientSocket {
    return this.of(namespace).connect();
  }

  /** Resolve with the server socket of the next client to connect on `namespace`. */
  nextConnection(namespace = '/'): Promise<ServerSocket> {
    return this.of(namespace).nextConnection();
  }

  // The server's own broadcast surface is the default namespace's: `io.emit()` is
  // exactly `io.of('/').emit()`, so "everyone" means everyone on `/` and never
  // reaches another namespace. Each form delegates rather than reimplements.
  emit(event: string, ...args: unknown[]): void {
    this.of('/').emit(event, ...args);
  }
  to(room: string | string[]): BroadcastContract {
    return this.of('/').to(room);
  }
  in(room: string | string[]): BroadcastContract {
    return this.of('/').in(room);
  }
  except(room: string | string[]): BroadcastContract {
    return this.of('/').except(room);
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
  /**
   * The namespace this socket lives on. `nsp.adapter` records its membership and
   * `nsp.sockets` turns a broadcast's target sids back into sockets to deliver to;
   * both belong to the namespace, so every operator this socket builds is scoped
   * to its own namespace (#44) and `socket.nsp` reads back the real object. The
   * disconnect cleanup (#45) drops this socket from the same `nsp.adapter`.
   */
  readonly nsp: Namespace;
  private peer!: ClientSocket;

  constructor(id: string, nsp: Namespace) {
    super();
    this.id = id;
    this.nsp = nsp;
  }

  /** Wire the paired client in; called by `Namespace.pair` before completion. */
  attachPeer(client: ClientSocket): void {
    this.peer = client;
  }

  /**
   * Server-side teardown for a disconnecting socket, one tick later through the
   * same `defer` every emit uses. An emit sent just before disconnect is already
   * queued, so deferring the teardown lets it arrive before the socket leaves its
   * rooms, keeping the per-socket FIFO invariant the marker proofs rely on.
   *
   * `disconnecting` fires while the rooms are still intact, so a handler can read
   * and notify them; `disconnect` fires once they are gone. Both carry `reason`,
   * the string real socket.io reports on this side (pinned in the tests).
   */
  private teardown(reason: string): void {
    defer(() => {
      this.dispatch('disconnecting', [reason]);
      for (const room of this.rooms) this.nsp.adapter.del(this.id, room);
      // Empty the live Set in place (contract: "emptied in place on teardown")
      // rather than replacing it, so any held reference sees it clear.
      this.rooms.clear();
      // Drop the socket from the namespace roster too: otherwise `io.emit()`
      // (empty target rooms means the whole `sockets` map) keeps delivering to a
      // socket that is already gone.
      this.nsp.sockets.delete(this.id);
      this.dispatch('disconnect', [reason]);
    });
  }

  /**
   * A client-initiated disconnect (`client.disconnect()`) reaching the server
   * side. The client already reported `io client disconnect` on its own side; the
   * server reports `client namespace disconnect`, real socket.io's reason here.
   */
  handleDisconnect(): void {
    this.teardown('client namespace disconnect');
  }

  /**
   * Server-initiated disconnect, socket.io's `socket.disconnect(close?)`. `close`
   * only decides whether the underlying connection is torn down too; a mock has no
   * transport and the reason is the same either way (pinned against real), so the
   * argument is accepted and ignored. The client side learns `io server
   * disconnect`; this side tears down with `server namespace disconnect`.
   */
  disconnect(_close?: boolean): void {
    this.peer.markDisconnected('io server disconnect');
    this.teardown('server namespace disconnect');
  }

  emit(event: string, ...args: unknown[]): void {
    send(this.peer, event, args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return emitWithAck(this.peer, event, args);
  }

  get broadcast(): BroadcastContract {
    // Everyone except the sender: no target rooms, except the sender's own id-room.
    return new BroadcastOperator(this.nsp.adapter, this.nsp.sockets, [], [this.id]);
  }
  join(room: string | string[]): void {
    // `join` takes one room or many; `leave` is always one, matching socket.io.
    // Each room is recorded in the adapter (both directions) and mirrored into
    // this socket's own `rooms`, the server-only view the tests observe.
    for (const r of Array.isArray(room) ? room : [room]) {
      this.nsp.adapter.add(this.id, r);
      this.rooms.add(r);
    }
  }
  leave(room: string): void {
    this.nsp.adapter.del(this.id, room);
    this.rooms.delete(room);
  }
  to(room: string | string[]): BroadcastContract {
    // The rooms, minus the sender: `socket.to(room)` is `socket.broadcast.to(room)`.
    // If the sender is itself a member of `room`, the room's union includes it and
    // the id-room except then removes it, so the sender is excluded for free.
    return new BroadcastOperator(this.nsp.adapter, this.nsp.sockets, asRooms(room), [this.id]);
  }
  except(room: string | string[]): BroadcastContract {
    // Everyone except both the named room's members and the sender: no target
    // rooms, except the given rooms plus the sender's own id-room.
    return new BroadcastOperator(
      this.nsp.adapter,
      this.nsp.sockets,
      [],
      [...asRooms(room), this.id],
    );
  }
}

export class ClientSocket extends Emitter implements ClientSocketContract {
  connected = false;
  id: string | undefined;
  /** The shared Manager stand-in; compared only by identity across namespaces. */
  readonly io: unknown;
  /**
   * The namespace this client is attached to. Held so `connect` (a reconnect) can
   * re-pair on the same namespace without routing through the dead server socket.
   */
  private readonly nsp: Namespace;
  /**
   * The current paired server socket. Assigned at `completeConnection`, not at
   * construction, and not readonly: a reconnect swaps in a new socket with a new
   * id, since the id belongs to one connection, not to the client.
   */
  private serverSocket!: ServerSocket;
  /** Emits made before `connect`; flushed in order once connected (like sendBuffer). */
  private sendBuffer: Array<[string, unknown[]]> = [];
  /**
   * Rejecters for acks still waiting for an answer. socket.io-client settles a
   * pending `emitWithAck` with an error when the socket disconnects instead of
   * leaving the promise hanging, so `disconnect` drains these. Only this promise
   * form is tracked: the trailing-callback ack and the server-to-client direction
   * stay silently pending on disconnect (pinned against real socket.io), so they
   * need no registry.
   */
  private readonly pendingAcks = new Set<(reason: Error) => void>();

  constructor(server: Server, nsp: Namespace) {
    super();
    this.io = server;
    this.nsp = nsp;
  }

  /**
   * Server accepted us on `serverSocket`: adopt it and its id, fire `connect`,
   * then flush buffered emits to it. On a reconnect this is a new socket and id,
   * and flushing after the swap sends the buffer (emits made while disconnected)
   * to the new socket, matching socket.io-client.
   */
  completeConnection(serverSocket: ServerSocket): void {
    this.serverSocket = serverSocket;
    this.connected = true;
    this.id = serverSocket.id;
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
    // Like the free `emitWithAck`, but the rejecter is registered so `disconnect`
    // can settle a still-pending ack, matching socket.io-client.
    return new Promise((resolve, reject) => {
      this.pendingAcks.add(reject);
      const answer = (value: unknown) => {
        this.pendingAcks.delete(reject);
        resolve(value);
      };
      const withAck = [...args, (...received: unknown[]) => answer(received[0])];
      // Before the first connect or while disconnected there is no live server
      // socket, so buffer the call the way `emit` does and let `completeConnection`
      // replay it to the (re)connected socket. `send` treats the trailing callback
      // as the ack, so a flushed emitWithAck still gets its answer. Delivering to
      // the stale `serverSocket` instead would leak the promise (the dead socket
      // never acks) and, before the first connect, dereference an undefined socket.
      if (!this.connected) {
        this.sendBuffer.push([event, withAck]);
        return;
      }
      send(this.serverSocket, event, withAck);
    });
  }

  connect(): void {
    // Already-connected `connect()` is a no-op in socket.io. Otherwise re-pair on
    // our namespace: a brand-new server socket and id, none of the old rooms.
    if (this.connected) return;
    this.nsp.pair(this);
  }

  disconnect(): void {
    if (!this.connected) return;
    // Client-initiated: this side reports `io client disconnect`, then the server
    // side tears down and reports `client namespace disconnect`.
    this.markDisconnected('io client disconnect');
    this.serverSocket.handleDisconnect();
  }

  /**
   * Flip to disconnected, settle any pending ack, and fire the client-side
   * `disconnect` with `reason`. Shared by a client-initiated disconnect and a
   * server-initiated one (`ServerSocket.disconnect`); only the reason differs.
   * socket.io-client settles a pending emitWithAck on disconnect instead of
   * leaving it hanging, which is why the rejecters are drained here.
   */
  markDisconnected(reason: string): void {
    this.connected = false;
    this.id = undefined;
    const rejecters = [...this.pendingAcks];
    this.pendingAcks.clear();
    for (const reject of rejecters) reject(new Error('socket has been disconnected'));
    this.dispatch('disconnect', [reason]);
  }
}

/**
 * The client `connect(url)` returns when no server is registered for the origin.
 * It never pairs: one tick later it fires `connect_error` once and logs the
 * failure to the console, then stops. This is smocket's single deliberate
 * divergence from real socket.io, which retries the connection forever (0005) —
 * that retry is driven by network timing a mock has no source for, so smocket
 * reports the failure and does not simulate it. The `console.error` is a
 * diagnostics layer over the event, so a mistyped url is not silent for the common
 * case of no `connect_error` handler.
 */
class FailedClientSocket extends Emitter implements ClientSocketContract {
  readonly connected = false;
  readonly id = undefined;
  readonly io = undefined;

  constructor(origin: string) {
    super();
    const message = `no server registered for ${origin}`;
    // Next tick through the same `defer` a successful connect uses (0005: no
    // artificial delay), so a `connect_error` handler added on the next line is
    // registered in time, the same ordering reason as a real connect (0004).
    defer(() => {
      console.error(`[smocket] connect_error: ${message}`);
      this.dispatch('connect_error', [new Error(message)]);
    });
  }

  // A failed connection never completes, so there is nothing to send, ack, or tear
  // down, and `connect()` does not retry: the failure was already reported (0005).
  emit(): void {
    /* inert: never connected */
  }
  emitWithAck(): Promise<unknown> {
    // No server will ever answer, so this stays pending, matching a client whose
    // connection never completes rather than inventing a rejection shape.
    return new Promise<unknown>(() => {});
  }
  connect(): void {
    /* inert: the failure is terminal, no retry (0005) */
  }
  disconnect(): void {
    /* inert: never connected */
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
