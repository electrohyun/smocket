import { randomBytes } from 'node:crypto';
import type {
  AdapterFactory,
  BroadcastContract,
  ClientSocketContract,
  ConnectionMiddleware,
  ConnectOptions,
  Handshake,
  MiddlewareError,
  NamespaceContract,
  ServerContract,
  ServerSocketContract,
  SmocketAdapter,
  SocketTimeoutContract,
  TimeoutBroadcastContract,
  TimeoutEmitterContract,
  VolatileClientSocket,
  VolatileServerSocket,
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

/**
 * Build the connection handshake for a freshly paired socket (0006). `auth` is already
 * resolved to an object (see `resolveAuth`) and carried through unchanged: it travels as
 * a packet payload, so the server reads it exactly as resolved, with no stringifying. `query`
 * is stringified: on real socket.io it rides the connection url, so every value arrives
 * as a string, and smocket matches that (`{ room: 1 }` -> `{ room: '1' }`) so a dual-run
 * comparison holds. `url` is the origin the client connected to, and `time` / `issued`
 * are the moment the pairing completes, the two timestamps a mock can supply exactly.
 */
function buildHandshake(
  url: string,
  auth: Record<string, unknown>,
  query?: Record<string, unknown>,
): Handshake {
  return {
    auth,
    query: stringifyValues(query ?? {}),
    url,
    time: new Date().toString(),
    issued: Date.now(),
  };
}

/**
 * Resolve the connection's auth to a plain object, then continue through `done`. An
 * object auth is handed straight over; a function auth is socket.io-client's callback
 * form, so it is invoked and the object it calls back with is the auth. The callback
 * may fire later than this tick (a token fetched async), which is exactly why the whole
 * pairing runs inside `done`: real socket.io holds the connection until the callback
 * fires, so a delayed callback delays the connect. A reconnect re-runs this resolve (the
 * reconnect path calls `pair` again), so the function is re-invoked for a fresh value.
 * Both behaviours pinned by measurement against the real client.
 */
function resolveAuth(
  auth: ConnectOptions['auth'],
  done: (auth: Record<string, unknown>) => void,
): void {
  if (typeof auth === 'function') {
    auth((data) => done(data ?? {}));
  } else {
    done(auth ?? {});
  }
}

/** Stringify every value of an object, the way a url querystring coerces them. */
function stringifyValues(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) out[key] = String(value);
  return out;
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
 *
 * When `volatile` is set (the `.volatile` broadcast forms, 0016) the routing is
 * unchanged; the only difference is a per-recipient drop: a target whose client has
 * not yet completed its connection is skipped rather than delivered to, matching real
 * socket.io deciding volatile per recipient. Connected recipients receive it as normal.
 */
class BroadcastOperator implements BroadcastContract, TimeoutBroadcastContract {
  private readonly targetRooms = new Set<string>();
  private readonly exceptRooms = new Set<string>();

  constructor(
    private readonly adapter: SmocketAdapter,
    private readonly sockets: Map<string, ServerSocket>,
    rooms: Iterable<string>,
    except: Iterable<string>,
    private readonly volatile = false,
    /** When set, `emit` with a trailing callback collects each recipient's ack (#112). */
    private timeoutMs: number | undefined = undefined,
  ) {
    for (const room of rooms) this.targetRooms.add(room);
    for (const room of except) this.exceptRooms.add(room);
  }

  to(room: string | string[]): BroadcastOperator {
    for (const r of asRooms(room)) this.targetRooms.add(r);
    return this;
  }

  /** Add an ack timeout, so the next `emit` with a trailing callback collects responses (#112). */
  timeout(ms: number): TimeoutBroadcastContract {
    this.timeoutMs = ms;
    return this;
  }

  /**
   * Resolve this broadcast's recipients: empty target rooms means "everyone" (`io.emit` /
   * `socket.broadcast`), otherwise the deduped union of the target rooms' members, minus the
   * except rooms (the sender's id-room for the `socket.*` forms). A volatile broadcast also
   * skips a recipient still in its pre-connect window (0016).
   */
  private recipients(): ServerSocket[] {
    const targets =
      this.targetRooms.size === 0
        ? new Set(this.sockets.keys())
        : this.adapter.socketsIn(this.targetRooms);
    const excluded = this.adapter.socketsIn(this.exceptRooms);
    const out: ServerSocket[] = [];
    for (const sid of targets) {
      if (excluded.has(sid)) continue;
      const socket = this.sockets.get(sid);
      if (!socket) continue;
      if (this.volatile && !socket.connected) continue;
      out.push(socket);
    }
    return out;
  }

  emit(event: string, ...args: unknown[]): void {
    const recipients = this.recipients();
    const last = args.at(-1);
    // A plain broadcast unless a timeout is armed and a trailing callback is present:
    // then it collects one ack per recipient and answers the callback once (#112).
    if (this.timeoutMs === undefined || typeof last !== 'function') {
      for (const socket of recipients) socket.emit(event, ...args);
      return;
    }
    this.collect(
      event,
      args.slice(0, -1),
      last as (...a: unknown[]) => void,
      recipients,
      this.timeoutMs,
    );
  }

  /**
   * Fan `event` out to `recipients` and gather their acks (#112). The callback fires once:
   * `(null, responses)` when every recipient answers before `ms`, or `(Error('operation has
   * timed out'), responses)` when the timer wins, where `responses` holds the acks that
   * arrived, in arrival order (measured on 4.8.3, not join order). A `settled` flag drops a
   * late ack and keeps the callback single-shot. No recipient resolves at once as `(null, [])`.
   */
  private collect(
    event: string,
    data: unknown[],
    callback: (...received: unknown[]) => void,
    recipients: ServerSocket[],
    ms: number,
  ): void {
    if (recipients.length === 0) {
      defer(() => callback(null, []));
      return;
    }
    const responses: unknown[] = [];
    let settled = false;
    let remaining = recipients.length;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      callback(new Error('operation has timed out'), responses);
    }, ms);
    for (const socket of recipients) {
      socket.emit(event, ...data, (...answer: unknown[]) => {
        if (settled) return;
        responses.push(answer[0]);
        remaining -= 1;
        if (remaining === 0) {
          settled = true;
          clearTimeout(timer);
          callback(null, responses);
        }
      });
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
  private readonly connectionListeners = new Map<string, Listener[]>();
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

  constructor(
    readonly name: string,
    /** The shared Manager stand-in every client here is given; see ClientSocket.io. */
    private readonly server: Server,
    /** The server's normalized origin, filled into each socket's `handshake.url` (0006). */
    private readonly origin: string,
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
   * pairing is `pair`, shared with reconnect. `source` carries the caller's `auth` /
   * `query` onto the handshake; a reconnect replays the client's own copy.
   */
  connect(source?: ConnectOptions): ClientSocket {
    const client = new ClientSocket(this.server, this, source);
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
    // Resolve the auth first, then pair. For an object auth this runs synchronously, so
    // the timing is unchanged; a function auth may call back later, and the connection
    // is held until it does (real socket.io holds the connect until the callback fires).
    resolveAuth(source?.auth, (auth) => {
      const handshake = buildHandshake(this.origin, auth, source?.query);
      const serverSocket = new ServerSocket(newId(), this, handshake);
      serverSocket.attachPeer(client);

      // Connection middleware runs here, after the handshake is built (so a middleware
      // reads the same fields a `connection` handler will) and before the socket is
      // considered connected. Its verdict gates the deferred completion below: on
      // rejection the socket is dropped before it is registered, joins its id-room, or
      // reaches `connection`, and the client learns of the failure through
      // `connect_error`; a reconnect re-runs `pair`, so the chain runs again for free.
      this.runMiddleware(serverSocket, (err) => {
        if (err) {
          client.failConnection(err);
          return;
        }
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
      });
    });
  }

  /**
   * Register a connection middleware, matching real socket.io's `namespace.use`.
   * Middleware are kept in registration order and run by `runMiddleware` on every
   * connection here.
   */
  use(middleware: ConnectionMiddleware): void {
    this.middleware.push(middleware);
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
      const list = this.connectionListeners.get(event);
      if (!list) continue;
      for (const listener of [...list]) (listener as (s: ServerSocket) => void)(socket);
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
}

/**
 * The origin registry: normalized origin -> the `Server` listening there. Every
 * `new Server(url)` registers itself here and every `connect(url)` resolves through
 * it, so the required url and this map are the one decision (0003). A module-level
 * singleton, cleared between tests through `resetRegistry`.
 */
const servers = new Map<string, Server>();

/**
 * Split a url into its origin (the registry key), namespace path, and query string,
 * normalizing the way socket.io's `url.js` does so two spellings of one origin
 * collapse to a single key (0003): a relative url resolves against `location.origin`,
 * and a missing port is filled from the scheme (http -> 80, https -> 443). The query
 * is one of the two sources for `handshake.query`, the other being the options argument;
 * `connect` resolves which one wins (the url does, when it carries a query).
 */
function parseUrl(url: string): {
  origin: string;
  namespace: string;
  query: Record<string, string>;
} {
  // `location` exists in a browser/jsdom run and is absent under plain node; read
  // it off `globalThis` so the reference type-checks either way.
  const base = (globalThis as { location?: { origin: string } }).location?.origin;
  const parsed = new URL(url, base);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const origin = `${parsed.protocol}//${parsed.hostname}:${port}`;
  const query: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) query[key] = value;
  return { origin, namespace: parsed.pathname, query };
}

/**
 * Attach a client to the server registered for `url`'s origin: smocket's
 * app-facing entry point, socket.io-client's `io(url, opts)`. The origin is resolved
 * through the registry (0003) and the url's path selects the namespace. `opts` carries
 * `auth` and `query` onto the handshake (0006). When no server is registered for that
 * origin, the returned client fires `connect_error` and does not retry (0005), rather
 * than throwing.
 *
 * `query` has two sources, the url's own query string and `opts.query`, and the url
 * wins: when the url carries a query, `opts.query` is ignored wholesale, and it is
 * consulted only when the url has none. This is not the intuitive "explicit option
 * wins" rule but is what socket.io-client 4.x does, measured against the real client,
 * so a dogfooding app sees the same handshake on either engine.
 */
export function connect(url: string, options?: ConnectOptions): ClientSocketContract {
  const { origin, namespace, query: urlQuery } = parseUrl(url);
  const server = servers.get(origin);
  if (!server) return new FailedClientSocket(origin);
  const query = Object.keys(urlQuery).length > 0 ? urlQuery : options?.query;
  return server.connect(namespace, { auth: options?.auth, query });
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
  /**
   * This server's normalized origin, its key in the module `servers` registry.
   * Private: it is internal bookkeeping with no counterpart on real socket.io, so
   * it stays off the public surface rather than becoming an undocumented addition.
   */
  private readonly origin: string;
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
    const namespace = new Namespace(name, this, this.origin, this.adapterFactory);
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

  /**
   * The server's `use` is the default namespace's: `io.use(fn)` registers a connection
   * middleware for connections on `/`, exactly `io.of('/').use(fn)`, socket.io's primary
   * place to authenticate a connection. Middleware on another namespace is registered
   * through `io.of(name).use(fn)`.
   */
  use(middleware: ConnectionMiddleware): void {
    this.of('/').use(middleware);
  }

  /**
   * Attach a client on `namespace` (`/` by default); see `Namespace.connect`.
   * `source` carries the caller's `auth` / `query` onto the connection's handshake.
   */
  connect(namespace = '/', source?: ConnectOptions): ClientSocket {
    return this.of(namespace).connect(source);
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
  timeout(ms: number): TimeoutBroadcastContract {
    // `io.timeout(ms)` is the default namespace's: `io.timeout(ms).to(room)` reaches only `/`.
    return this.of('/').timeout(ms);
  }
  get volatile(): BroadcastContract {
    // `io.volatile` is the default namespace's: `io.volatile.to(room)` reaches only `/`.
    return this.of('/').volatile;
  }
}

/**
 * Events smocket dispatches locally rather than receiving from the peer. A
 * catch-all (`onAny`) skips them, matching socket.io, whose catch-all fires only
 * for events that arrive as packets, never for the lifecycle ones.
 */
const RESERVED_EVENTS = new Set(['connect', 'connect_error', 'disconnect', 'disconnecting']);

/**
 * A minimal event target shared by both socket sides: a listener registry, the
 * `on`/`once` the tests register through, and `dispatch`, which fires this
 * side's own listeners. Delivery from the peer goes through `send`, which calls
 * the target's `dispatch` a tick later.
 */
class Emitter {
  private readonly listeners = new Map<string, Listener[]>();
  /** Catch-all listeners, fired for every non-reserved event before the specific ones. */
  private readonly anyListeners: Listener[] = [];
  /** Outgoing catch-all listeners, fired for every event this socket sends (#111). */
  private readonly anyOutgoingListeners: Listener[] = [];

  on(event: string, listener: Listener): void {
    addListener(this.listeners, event, listener);
  }

  once(event: string, listener: Listener): void {
    const wrapper = ((...args: never[]) => {
      removeFirst(this.listeners.get(event), wrapper);
      listener(...args);
    }) as Listener;
    // Carry the original so `off(listener)` can find a `once` registration through
    // its wrapper, the way socket.io's emitters do.
    (wrapper as { listener?: Listener }).listener = listener;
    addListener(this.listeners, event, wrapper);
  }

  onAny(listener: Listener): void {
    this.anyListeners.push(listener);
  }

  offAny(listener?: Listener): void {
    // Remove the first matching registration, the way `off` removes one specific
    // listener; with no argument, clear every catch-all. socket.io's `offAny`
    // splices the first occurrence out of its `_anyListeners` array (#125).
    if (listener) removeFirst(this.anyListeners, listener);
    else this.anyListeners.length = 0;
  }

  onAnyOutgoing(listener: Listener): void {
    this.anyOutgoingListeners.push(listener);
  }

  offAnyOutgoing(listener?: Listener): void {
    // The outgoing catch-all's removal mirrors `offAny` (#111): drop the first match,
    // or clear all with no argument.
    if (listener) removeFirst(this.anyOutgoingListeners, listener);
    else this.anyOutgoingListeners.length = 0;
  }

  /**
   * Fire the outgoing catch-all for an event this socket sends (#111), the sending
   * counterpart of the `dispatch` catch-all. It runs at the send site (`emit` /
   * `emitWithAck`), before the peer receives anything, and the listeners get the event
   * name then the args. A trailing ack function is stripped first, so the catch-all sees
   * the same args whether the emit carried an ack or not (measured on 4.8.3), and reserved
   * lifecycle events are skipped, exactly as the incoming catch-all skips them.
   */
  protected emitOutgoing(event: string, args: unknown[]): void {
    if (this.anyOutgoingListeners.length === 0 || RESERVED_EVENTS.has(event)) return;
    const last = args.at(-1);
    const outgoing = typeof last === 'function' ? args.slice(0, -1) : args;
    for (const any of [...this.anyOutgoingListeners]) {
      (any as (...a: unknown[]) => void)(event, ...outgoing);
    }
  }

  /**
   * Remove one registration for `event`, matching the original listener even when it
   * was registered through a `once` wrapper (socket.io keeps the original on the
   * wrapper and compares against it). A listener that was never registered, or an
   * event with none, is a no-op.
   *
   * Which occurrence goes differs by side, and it is observable once the same
   * function is registered twice (#125): the client is component-emitter, which
   * splices the *first* match; the server is Node's emitter, which scans from the
   * end and removes the *last* (measured on 4.8.3). This is the client's
   * first-match half; `ServerSocket` removes through `removeLast` instead (0017).
   */
  protected removeOne(event: string, listener: Listener): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const i = list.findIndex((r) => isListener(r, listener));
    if (i !== -1) list.splice(i, 1);
  }

  /**
   * The server's counterpart to `removeOne`: Node's emitter removes the last
   * matching registration, not the first, so a doubly-registered listener drops
   * its most recent registration first. Same match rule (direct or `once`
   * wrapper), scanned from the end.
   */
  protected removeLast(event: string, listener: Listener): void {
    const list = this.listeners.get(event);
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      if (entry !== undefined && isListener(entry, listener)) {
        list.splice(i, 1);
        return;
      }
    }
  }

  /** Clear every listener for `event`, or every listener on the socket with no argument. */
  removeAllListeners(event?: string): void {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
  }

  /**
   * Fire this side's listeners for `event`. Internal; the peer's `send` calls it.
   * A catch-all runs first and receives the event name ahead of the args, for
   * every event except the reserved lifecycle ones, which are dispatched locally
   * rather than received from the peer.
   */
  dispatch(event: string, args: unknown[]): void {
    if (this.anyListeners.length > 0 && !RESERVED_EVENTS.has(event)) {
      for (const any of [...this.anyListeners]) {
        (any as (...a: unknown[]) => void)(event, ...args);
      }
    }
    const list = this.listeners.get(event);
    if (!list) return;
    for (const listener of [...list]) (listener as (...a: unknown[]) => void)(...args);
  }
}

/**
 * The client-side emitter. Its `off` follows component-emitter, where the
 * no-listener forms clear rather than throw: `off()` clears every listener,
 * `off(event)` clears that event, and `off(event, listener)` removes one. This is
 * the half that differs from the server's Node emitter (0017), and it is shared by
 * both the connected client and the failed-connection client.
 */
class ClientEmitter extends Emitter {
  off(event?: string, listener?: Listener): void {
    if (event === undefined) {
      this.removeAllListeners();
    } else if (listener === undefined) {
      this.removeAllListeners(event);
    } else {
      this.removeOne(event, listener);
    }
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
  /**
   * The connection handshake (0006), built when the pairing completes and read by a
   * `connection` handler as `socket.handshake`. Carries the caller's `auth` / `query`
   * and the fields smocket derives from the connection itself.
   */
  readonly handshake: Handshake;
  /**
   * The per-socket store (#108): an empty object at creation that middleware writes and a
   * handler reads, to carry what middleware resolved from the handshake. A fresh socket
   * gets a fresh object, so a reconnection (a new socket, 0013) starts empty, which ties
   * `data` to the socket rather than the client identity, matching real socket.io.
   */
  readonly data: Record<string, unknown> = {};
  private peer!: ClientSocket;

  constructor(id: string, nsp: Namespace, handshake: Handshake) {
    super();
    this.id = id;
    this.nsp = nsp;
    this.handshake = handshake;
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
    this.emitOutgoing(event, args);
    send(this.peer, event, args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    this.emitOutgoing(event, args);
    return emitWithAck(this.peer, event, args);
  }
  /**
   * Arm a per-emit ack timer. `emit` / `emitWithAck` are the single-ack forms, sent to the
   * peer through this socket's own `emit`; `to` / `broadcast` / `except` are the ack-collecting
   * broadcast forms (#112), each a timeout-carrying operator that excludes the sender the way
   * `socket.broadcast` does. So a timeout set first still reaches every broadcast shape, and
   * `.timeout` / `.to` / `.broadcast` are freely ordered, matching real socket.io.
   */
  timeout(ms: number): SocketTimeoutContract {
    const single = new TimeoutEmitter((event, args) => this.emit(event, ...args), ms);
    return {
      emit: (event, ...args) => single.emit(event, ...args),
      emitWithAck: (event, ...args) => single.emitWithAck(event, ...args),
      broadcast: new BroadcastOperator(
        this.nsp.adapter,
        this.nsp.sockets,
        [],
        [this.id],
        false,
        ms,
      ),
      to: (room) =>
        new BroadcastOperator(
          this.nsp.adapter,
          this.nsp.sockets,
          asRooms(room),
          [this.id],
          false,
          ms,
        ),
      except: (room) =>
        new BroadcastOperator(
          this.nsp.adapter,
          this.nsp.sockets,
          [],
          [...asRooms(room), this.id],
          false,
          ms,
        ),
    };
  }

  /**
   * Whether the paired client has completed its connection. A volatile emit targeted at a
   * socket whose client is not yet connected is dropped (0016); the volatile broadcast path
   * reads this to make that per-recipient decision.
   */
  get connected(): boolean {
    return this.peer.connected;
  }

  /**
   * The volatile emitter (0016). A volatile emit is an ordinary emit once the client is
   * connected and is dropped in the pre-connect window; a fresh view is returned each access,
   * so the volatile flag never leaks into the socket's own `emit`. Its broadcast forms mirror
   * `broadcast` / `to` / `except`, carrying the volatile flag into the operator.
   */
  get volatile(): VolatileServerSocket {
    return {
      emit: (event, ...args) => {
        // A dropped (pre-connect) volatile emit is never sent, so it fires no outgoing
        // catch-all; a connected one delivers and runs it, like a plain emit (#111).
        if (!this.peer.connected) return;
        this.emitOutgoing(event, args);
        send(this.peer, event, args);
      },
      emitWithAck: (event, ...args) => {
        if (!this.peer.connected) return new Promise<unknown>(() => {});
        this.emitOutgoing(event, args);
        return emitWithAck(this.peer, event, args);
      },
      broadcast: new BroadcastOperator(this.nsp.adapter, this.nsp.sockets, [], [this.id], true),
      to: (room) =>
        new BroadcastOperator(this.nsp.adapter, this.nsp.sockets, asRooms(room), [this.id], true),
      except: (room) =>
        new BroadcastOperator(
          this.nsp.adapter,
          this.nsp.sockets,
          [],
          [...asRooms(room), this.id],
          true,
        ),
    };
  }

  /**
   * The server socket is Node's `EventEmitter`, whose `off` (`removeListener`)
   * requires a listener: `off(event)` with none throws rather than clearing the
   * event, so bulk removal here is `removeAllListeners` (0017).
   */
  off(event: string, listener: Listener): void {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type function. Received undefined');
    }
    this.removeLast(event, listener);
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

export class ClientSocket extends ClientEmitter implements ClientSocketContract {
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
  /**
   * The caller's `auth` / `query`, held so a reconnect (`connect`) can rebuild the
   * same handshake on its fresh server socket, the way socket.io-client resends the
   * connection's auth and query on every reattach.
   */
  private readonly handshakeSource?: ConnectOptions;

  constructor(server: Server, nsp: Namespace, source?: ConnectOptions) {
    super();
    this.io = server;
    this.nsp = nsp;
    this.handshakeSource = source;
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

  /**
   * A connection middleware rejected us: fire `connect_error` a tick later, carrying
   * the middleware's error (its `message`, and its `data` if set) the way real
   * socket.io's client rebuilds it. The connection never completes, so the client
   * stays `connected === false` with no id; unlike a missing-server failure (0005),
   * this is an app-driven rejection, so it is not logged to the console. The deferral
   * matches a successful connect's one-tick delay, so a `connect_error` handler added
   * on the next line is registered in time.
   */
  failConnection(err: MiddlewareError): void {
    defer(() => this.dispatch('connect_error', [err]));
  }

  emit(event: string, ...args: unknown[]): void {
    // The outgoing catch-all fires at the send site, before the packet leaves and
    // regardless of whether it is buffered first (#111).
    this.emitOutgoing(event, args);
    // Before the connection completes, emits are buffered rather than lost, and
    // replayed in order at `completeConnection`, matching socket.io-client.
    if (!this.connected) {
      this.sendBuffer.push([event, args]);
      return;
    }
    send(this.serverSocket, event, args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    // The outgoing catch-all fires for emitWithAck too (#111); the internally added
    // ack never reaches it, and neither does a caller's, since `emitOutgoing` strips
    // a trailing function.
    this.emitOutgoing(event, args);
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

  /**
   * Arm a per-emit ack timer on the next emit. The wrapper sends through this client's
   * own `emit`, so a timed emit made before connect still buffers and replays on connect
   * while the timer counts down, matching a bare emit's buffering.
   */
  timeout(ms: number): TimeoutEmitterContract {
    return new TimeoutEmitter((event, args) => this.emit(event, ...args), ms);
  }

  /**
   * The volatile emitter (0016). Unlike a normal emit, a volatile one is not buffered while
   * disconnected: sent before the connection completes it is dropped, and once connected it is
   * an ordinary emit. `this.connected` / `this.serverSocket` are read at emit time, not now.
   */
  get volatile(): VolatileClientSocket {
    return {
      emit: (event, ...args) => {
        // Dropped (pre-connect) volatile emits are never sent, so they fire no outgoing
        // catch-all; a connected one delivers and runs it, like a plain emit (#111).
        if (!this.connected) return;
        this.emitOutgoing(event, args);
        send(this.serverSocket, event, args);
      },
      emitWithAck: (event, ...args) => {
        if (!this.connected) return new Promise<unknown>(() => {});
        this.emitOutgoing(event, args);
        return emitWithAck(this.serverSocket, event, args);
      },
    };
  }

  connect(): void {
    // Already-connected `connect()` is a no-op in socket.io. Otherwise re-pair on
    // our namespace: a brand-new server socket and id, none of the old rooms, and the
    // same handshake source, so the reattached socket carries the original auth/query.
    if (this.connected) return;
    this.nsp.pair(this, this.handshakeSource);
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
class FailedClientSocket extends ClientEmitter implements ClientSocketContract {
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
  timeout(): TimeoutEmitterContract {
    // Inert like the rest of this socket: the emit never leaves and the promise never
    // settles, so no timer is armed and the terminal failure stays terminal (0005).
    return {
      emit() {
        /* inert: never connected */
      },
      emitWithAck: () => new Promise<unknown>(() => {}),
    };
  }
  get volatile(): VolatileClientSocket {
    // Never connected, so a volatile emit is always in the pre-connect window: dropped,
    // and its ack stays pending, exactly like the inert `emit` / `emitWithAck` above (0016).
    return {
      emit: () => {},
      emitWithAck: () => new Promise<unknown>(() => {}),
    };
  }
  connect(): void {
    /* inert: the failure is terminal, no retry (0005) */
  }
  disconnect(): void {
    /* inert: never connected */
  }
}

/**
 * The object `socket.timeout(ms)` returns: a per-emit wrapper that races the ack
 * against a real `ms` timer, rather than mutating the socket (measured against real
 * socket.io — `timeout` applies to the next emit only). It layers the timer over the
 * socket's own send path, which it is handed as `deliver`, so the emit still buffers,
 * defers, and collapses the ack to its first value exactly like a bare emit; only the
 * race is added on top.
 *
 * The race settles exactly once. When the ack answers first, the timer is cleared and
 * the callback gets `(null, response)`, error-first with the collapsed first value. When
 * the timer fires first, the callback gets a lone `Error('operation has timed out')` and
 * `settled` then drops the late ack, so the callback never fires a second time. All three
 * shapes (the null-first success, the single-argument timeout error, the dropped late ack)
 * are pinned against real socket.io.
 */
class TimeoutEmitter implements TimeoutEmitterContract {
  constructor(
    /** The socket's ordinary send path (its own `emit`), so buffering and FIFO still hold. */
    private readonly deliver: (event: string, args: unknown[]) => void,
    private readonly ms: number,
  ) {}

  emit(event: string, ...args: unknown[]): void {
    const last = args.at(-1);
    // No trailing callback: a plain emit that delivers and arms no timer (measured).
    if (typeof last !== 'function') {
      this.deliver(event, args);
      return;
    }
    const callback = last as (...received: unknown[]) => void;
    const data = args.slice(0, -1);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Timeout fires with a single argument, a plain timeout Error and no response.
      callback(new Error('operation has timed out'));
    }, this.ms);
    // The ack wrapper is the trailing function, so the socket's `send` treats it as the
    // ack and delivers the peer's answer here a tick later. Winning the race clears the
    // timer and answers error-first; losing it is a no-op, so the late ack is dropped.
    this.deliver(event, [
      ...data,
      (...answer: unknown[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(null, answer[0]);
      },
    ]);
  }

  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    // The same race as a promise: resolve with the response, reject with the timeout Error.
    return new Promise((resolve, reject) => {
      this.emit(event, ...args, (error: Error | null, response: unknown) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
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

// Store listeners in arrays, not Sets, so a callback registered twice is kept
// twice and fired once per registration, the way real socket.io's emitters do
// (#125). A Set would de-duplicate, calling a doubly-registered callback once.
function addListener(map: Map<string, Listener[]>, event: string, listener: Listener): void {
  const list = map.get(event) ?? [];
  list.push(listener);
  map.set(event, list);
}

/** Remove the first occurrence of `listener` from `list` in place, if present. */
function removeFirst(list: Listener[] | undefined, listener: Listener): void {
  if (!list) return;
  const i = list.indexOf(listener);
  if (i !== -1) list.splice(i, 1);
}

/** True if `entry` is `listener`, directly or as the `once` wrapper carrying it. */
function isListener(entry: Listener, listener: Listener): boolean {
  return entry === listener || (entry as { listener?: Listener }).listener === listener;
}
