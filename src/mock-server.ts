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
 * covers the connect lifecycle and id pairing (#40), event delivery with
 * acknowledgements in both directions (#41), rooms (#42), broadcast (#43) and
 * per-namespace isolation (#44). Membership cleanup on disconnect (#45) is still
 * a `notImplemented` seam (`client.connect`) so mock mode fails legibly, one
 * message per unfinished feature, instead of on a mystery `undefined`.
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
 */
class Adapter {
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
    private readonly adapter: Adapter,
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
  /** This namespace's room membership. */
  readonly adapter = new Adapter();
  /** Server sockets connected here but not yet claimed by a `nextConnection`. */
  private readonly ready: ServerSocket[] = [];
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
  ) {}

  /**
   * Attach a client to this namespace in memory and return the client side. The
   * client comes back not-yet-connected (`connected === false`, `id` undefined);
   * a tick later the paired server socket is offered to `nextConnection` and the
   * client's `connect` fires. The server socket is created up front and handed to
   * `nextConnection` from here, never from a fresh connection, so the two never
   * race. The client takes the `Server` as its `io`, so two clients on different
   * namespaces share one Manager stand-in — one multiplexed connection.
   */
  connect(): ClientSocket {
    const id = newId();
    const serverSocket = new ServerSocket(id, this);
    const client = new ClientSocket(id, this.server, serverSocket);
    serverSocket.attachPeer(client);

    // Connection completes a tick later (decision 3-4b). The server-side socket
    // is registered and offered first, then the client-side `connect` fires, the
    // order real socket.io uses.
    defer(() => {
      // Register the socket before offering it, so a broadcast triggered from a
      // `connection` handler can already resolve this sid to its socket.
      this.sockets.set(serverSocket.id, serverSocket);
      // Auto-join the room named after the socket's own id, exactly as real
      // socket.io does on connect. Reusing `join` carries the adapter update in
      // both directions and the `socket.rooms` mirror. This id-room is what makes
      // `io.to(socketId)` address a single socket and what sender exclusion
      // subtracts (see `BroadcastOperator`); without it those cases have no room
      // to name.
      serverSocket.join(serverSocket.id);
      this.offer(serverSocket);
      client.completeConnection();
    });
    return client;
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

export class Server implements ServerContract {
  /**
   * The namespace registry. Every connection, room and broadcast lives on a
   * `Namespace`; the server is the front door that routes to one. `of` is
   * get-or-create and returns the *same* `Namespace` on repeat calls, so the
   * `connect` path and an `of()` observation in a test reach one object.
   */
  private readonly namespaces = new Map<string, Namespace>();

  /** Get the namespace by name, creating it on first use (socket.io's lazy `of`). */
  of(name: string): Namespace {
    const existing = this.namespaces.get(name);
    if (existing) return existing;
    const namespace = new Namespace(name, this);
    this.namespaces.set(name, namespace);
    return namespace;
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
