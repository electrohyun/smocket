import type {
  AdapterFactory,
  BroadcastContract,
  BroadcastTrace,
  ClientSocketContract,
  ConnectionMiddleware,
  ConnectOptions,
  DecorateAcknowledgements,
  DecorateAcknowledgementsWithMultipleResponses,
  DefaultEventsMap,
  DefaultSocketData,
  DeliveryTimer,
  EventNameWithoutAck,
  EventParams,
  EventsMap,
  Handshake,
  MessageEventParams,
  MiddlewareError,
  NamespaceContract,
  ParentNspNameMatchFn,
  ReservedOrUserEventName,
  ReservedOrUserListener,
  ServerReservedEvents,
  ServerSocketContract,
  SmocketAdapter,
  SmocketServer,
  SupportedServerListenerEvents,
  TimeoutBroadcastContract,
} from './contract';

/**
 * An event listener, matching the `Listener` shape the contract's sockets use:
 * `never[]` parameters so callbacks of any argument shape are accepted.
 */
type Listener = (...args: never[]) => void;
type OrdinaryEventName = string | symbol;

/** Socket.IO's permissive callback shape for the live catch-all lookup arrays. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyListener = (...args: any[]) => void;

/** Modifiers stored on a socket until its next direct emit or broadcast creation. */
interface SocketFlags {
  volatile?: boolean;
  timeout?: number;
}

/** One client-to-namespace pairing from auth resolution through admission. */
interface ConnectionAttempt {
  state: 'pending' | 'cancelled' | 'rejected' | 'connected';
  serverSocket?: ServerSocket;
}

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

/**
 * `Buffer.toString('base64url')` done by hand, over `btoa` and two character swaps.
 *
 * The padding strip is load-bearing despite looking like a no-op at the id's length.
 * `base64url` omits padding and `btoa` emits it, and the two agree only when the byte
 * length is a multiple of three, which 15 is. Drop the strip and ids stay correct until
 * the day someone changes the length, then quietly grow a `=`.
 *
 * Exported for `socket-id.test.ts`, which is the only caller that can pass a length
 * other than the id's and so the only place that claim can be pinned. Not re-exported
 * from `index.ts`, so it stays internal to the package.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * socket.io ids are 20-char url-safe base64. Match the shape, not the source (0011).
 *
 * The entropy comes from Web Crypto and the encoding is done by hand, because
 * `node:crypto` was the package's last host-specific import and it did not survive
 * the trip to a browser (#139): a bundler's `Buffer` shim has no `base64url`, so
 * `newId` threw and no client could connect anywhere but Node. `globalThis.crypto`
 * has been a global since Node 19, so nothing is given up on the Node side.
 */
function newId(): string {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
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

/** One default-parser payload captured at its Socket.IO encode boundary (0026). */
type EncodedPayload = { kind: 'json'; value: string } | { kind: 'binary'; value: unknown[] };

/**
 * Whether a value makes this a binary packet, which ADR 0026 deliberately excludes.
 * Keep those packets on the existing in-memory path rather than applying JSON rules
 * that Socket.IO's binary encoder does not use. The walk is cycle-safe so a non-binary
 * cycle still reaches JSON.stringify below and fails at the selected encode boundary.
 */
function containsBinary(value: unknown, seen = new Set<object>(), inspectToJSON = true): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  const toJSON = (value as { toJSON?: () => unknown }).toJSON;
  if (inspectToJSON && typeof toJSON === 'function') {
    return containsBinary(toJSON.call(value), seen, false);
  }
  if (seen.has(value)) return false;
  seen.add(value);
  for (const nested of Object.values(value)) {
    if (containsBinary(nested, seen)) return true;
  }
  return false;
}

/** Snapshot one argument list the way the default non-binary parser crosses JSON. */
function encodePayload(args: unknown[]): EncodedPayload {
  if (containsBinary(args)) return { kind: 'binary', value: args };
  return { kind: 'json', value: JSON.stringify(args) };
}

/** Decode separately at each receiver, so broadcasts never share their object graph. */
function decodePayload(payload: EncodedPayload): unknown[] {
  return payload.kind === 'json' ? (JSON.parse(payload.value) as unknown[]) : payload.value;
}

/**
 * A pending connection waiting to be handed to `nextConnection`, or a
 * `nextConnection` call waiting for the next connection. `connect` and
 * `nextConnection` meet through two queues so either can arrive first: the
 * `connectClient` path connects before it awaits `nextConnection`, while a
 * reconnect awaits `nextConnection` before it calls `connect`.
 */
interface Waiter {
  resolve(socket: ServerSocket): void;
  reject(error: Error): void;
}

/** Give every closed direct-connection call the same ordinary rejection shape. */
function serverClosedError(): Error {
  return new Error('server is closed');
}

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
 * One host-neutral socket.io-client Manager identity (0028). It remembers the
 * namespace sockets created through it, including admission still in progress, and
 * the order in which they connect, but models no Engine.IO transport, retry,
 * heartbeat, or fallback behavior.
 */
class Manager {
  private readonly namespaces = new Set<string>();
  private readonly pendingClients = new Set<ClientSocket>();
  private readonly connectedClients = new Set<ClientSocket>();

  constructor(namespace: string) {
    this.namespaces.add(namespace);
  }

  owns(namespace: string): boolean {
    return this.namespaces.has(namespace);
  }

  claim(namespace: string): void {
    this.namespaces.add(namespace);
  }

  registerPending(client: ClientSocket): void {
    this.pendingClients.add(client);
  }

  settlePending(client: ClientSocket): void {
    this.pendingClients.delete(client);
  }

  connected(client: ClientSocket): void {
    this.pendingClients.delete(client);
    this.connectedClients.add(client);
  }

  disconnected(client: ClientSocket): void {
    this.connectedClients.delete(client);
  }

  /** Close connected namespaces in order and cancel admission still pending on this Manager. */
  disconnect(initiator: ServerSocket): void {
    for (const client of [...this.connectedClients]) client.disconnectFromServer();
    for (const client of [...this.pendingClients]) {
      // The server `connection` handler runs while its client attempt is technically
      // pending. Preserve that initiating socket's synchronous server lifecycle below;
      // every other pending namespace must be cancelled with the shared Manager.
      if (!client.ownsConnection(initiator)) client.cancelConnectionAttemptFromManager();
    }
    // A server `connection` handler runs before the initiating client reaches its
    // `connect` event and Manager roster. Include that socket explicitly; on the
    // ordinary connected path its teardown guard makes this duplicate a no-op.
    initiator.disconnectNamespaceFromServer();
  }
}

/** The default `DeliveryTimer`: real `setTimeout` / `Date.now`, which fake timers can drive. */
const realTimer: DeliveryTimer = {
  schedule: (fn, ms) => {
    setTimeout(fn, ms);
  },
  now: () => Date.now(),
};

/**
 * A `SmocketAdapter` that delays what a socket's client receives by a per-sid amount (#78),
 * the mock-only affordance for interleaving events across sockets deterministically in a
 * race-condition test. It slows the client-inbound stream (server -> client) only; a socket's
 * server side still receives its client's emits on the next tick, so a delay never couples
 * the two directions. It extends the built-in `Adapter`, so routing is unchanged; it adds
 * only the delivery-scheduling hook. Register it through `io.adapter` and set delays by sid:
 *
 *   let delaying!: DelayingAdapter;
 *   io.adapter(() => (delaying = new DelayingAdapter(timer)));
 *   // ...connect sockets...
 *   delaying.setDelay(slowSid, 20);
 *
 * Note the factory runs once per namespace, so the captured `delaying` is whichever namespace
 * was created last; a test that uses more than one namespace should key its own map of them
 * rather than a single variable.
 *
 * Order within the stream is preserved (0010): deliveries drain through a per-sid FIFO queue
 * one at a time, so a just-lowered delay never lets a new event overtake one already waiting,
 * and order never rides on the timer's equal-deadline callback ordering. The scheduling goes
 * through an injected `DeliveryTimer` (default real, fake-timer-drivable), so a test never
 * waits on the wall clock. A delay applies to event
 * delivery only: an acknowledgement answer and the connect / disconnect lifecycle return on
 * the normal tick. Whole-socket removal drains pending deliveries before teardown completes.
 */
export class DelayingAdapter extends Adapter {
  private readonly delays = new Map<string, number>();
  /**
   * A per-sid FIFO queue of pending deliveries, each with the time it may fire. Only the
   * head is ever scheduled; the next is scheduled after the head runs, so order is a
   * structural property of the queue, not of the timer's callback ordering (#78).
   */
  private readonly queues = new Map<string, Array<{ deliver: () => void; fireAt: number }>>();

  constructor(private readonly timer: DeliveryTimer = realTimer) {
    super();
  }

  /**
   * Set the delivery delay for `sid` in ms; `0` (or any non-positive value) clears it,
   * dropping the entry so the sid is back on the default next-tick delivery. A non-finite
   * value (`NaN` / `Infinity`) is ignored, since it has no meaning as a delay. It applies to
   * deliveries scheduled after this call; anything already queued keeps the delay it was
   * scheduled with.
   */
  setDelay(sid: string, ms: number): void {
    if (!Number.isFinite(ms)) return;
    if (ms <= 0) this.delays.delete(sid);
    else this.delays.set(sid, ms);
  }

  scheduleDelivery(sid: string, deliver: () => void): void {
    const fireAt = this.timer.now() + (this.delays.get(sid) ?? 0);
    const queue = this.queues.get(sid);
    // A drain is already running for this sid: append and let it pick this up in order.
    if (queue) {
      queue.push({ deliver, fireAt });
      return;
    }
    this.queues.set(sid, [{ deliver, fireAt }]);
    this.pump(sid);
  }

  /**
   * Fire the head of `sid`'s queue when its time is due, then drain the next. Because only
   * the head is scheduled at a time and the next is scheduled from inside the head's run,
   * a later delivery can never dispatch before an earlier one, whatever the delays or the
   * timer's equal-deadline ordering. A head already due (delay 0, or a later delivery whose
   * fire time has passed while it waited behind another) keeps the plain next-tick `defer`,
   * so a socket the test never delayed behaves exactly as it would with the built-in adapter.
   */
  private pump(sid: string): void {
    const queue = this.queues.get(sid);
    if (!queue) return;
    const head = queue[0];
    if (!head) {
      this.queues.delete(sid);
      return;
    }
    const run = () => {
      if (this.queues.get(sid) !== queue) return;
      queue.shift();
      head.deliver();
      if (this.queues.get(sid) !== queue) return;
      this.pump(sid);
    };
    const wait = head.fireAt - this.timer.now();
    if (wait <= 0) defer(run);
    else this.timer.schedule(run, wait);
  }

  /** Drain pending deliveries in order, then release all scheduler state for this socket. */
  removeSocket(sid: string): void {
    this.delays.delete(sid);
    const queue = this.queues.get(sid);
    if (!queue) return;
    this.queues.delete(sid);
    for (const entry of queue) entry.deliver();
  }
}

/**
 * A payload-free recorder for final broadcast routing decisions. It wraps any
 * `SmocketAdapter`, forwarding membership, routing, scheduling, and removal while
 * retaining immutable trace snapshots until `clear` is called.
 */
export class TracingAdapter implements SmocketAdapter {
  readonly rooms: Map<string, Set<string>>;
  readonly sids: Map<string, Set<string>>;
  private readonly traces: BroadcastTrace[] = [];

  constructor(private readonly adapter: SmocketAdapter = new Adapter()) {
    this.rooms = adapter.rooms;
    this.sids = adapter.sids;
  }

  add(sid: string, room: string): void {
    this.adapter.add(sid, room);
  }

  del(sid: string, room: string): void {
    this.adapter.del(sid, room);
  }

  socketsIn(rooms: Iterable<string>): Set<string> {
    return this.adapter.socketsIn(rooms);
  }

  removeSocket(sid: string): void {
    this.adapter.removeSocket?.(sid);
  }

  scheduleDelivery(sid: string, deliver: () => void): void {
    if (this.adapter.scheduleDelivery) this.adapter.scheduleDelivery(sid, deliver);
    else defer(deliver);
  }

  traceBroadcast(trace: BroadcastTrace): void {
    this.traces.push(trace);
  }

  getTraces(): readonly BroadcastTrace[] {
    return Object.freeze([...this.traces]);
  }

  clear(): void {
    this.traces.length = 0;
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
 * Every way of narrowing a broadcast — `to` / `in` / `except` / `timeout` — is on the
 * operator as well as on the entry points, so the order they are chained in does not
 * change the recipients (#137): `io.to(a).except(b)` and `io.except(b).to(a)` build the
 * same two sets. Each returns a *new* operator over the merged sets rather than narrowing
 * this one, measured against real socket.io: an operator held in a variable is a fixed
 * target, and a later chained call on it produces another operator instead of widening the
 * one already held. `to` unions in more rooms, so `io.to(a).to(b)` targets the union of
 * both, and `except` unions likewise.
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
  private readonly targetRooms: Set<string>;
  private readonly exceptRooms: Set<string>;

  constructor(
    private readonly adapter: SmocketAdapter,
    private readonly sockets: Map<string, ServerSocket>,
    rooms: Iterable<string>,
    except: Iterable<string>,
    private readonly isVolatile = false,
    /** When set, `emit` with a trailing callback collects each recipient's ack (#112). */
    private readonly timeoutMs: number | undefined = undefined,
  ) {
    this.targetRooms = new Set(rooms);
    this.exceptRooms = new Set(except);
  }

  /**
   * One more narrowing of this broadcast, as a new operator (#137). The adapter, the
   * socket map, and the volatile flag are carried over untouched; only the two sets and
   * the timeout ever differ, which is why every chaining method below is one call to this.
   */
  private narrow(
    rooms: Iterable<string>,
    except: Iterable<string>,
    timeoutMs = this.timeoutMs,
  ): BroadcastOperator {
    return new BroadcastOperator(
      this.adapter,
      this.sockets,
      rooms,
      except,
      this.isVolatile,
      timeoutMs,
    );
  }

  to(room: string | string[]): BroadcastOperator {
    return this.narrow([...this.targetRooms, ...asRooms(room)], this.exceptRooms);
  }

  in(room: string | string[]): BroadcastOperator {
    // `in` is a pure alias of `to` here too; delegate so the two cannot drift.
    return this.to(room);
  }

  except(room: string | string[]): BroadcastOperator {
    return this.narrow(this.targetRooms, [...this.exceptRooms, ...asRooms(room)]);
  }

  /** Add an explicit deadline to the acknowledgement collector used by callback and Promise forms. */
  timeout(ms: number): BroadcastOperator {
    return this.narrow(this.targetRooms, this.exceptRooms, ms);
  }

  /** Compression is transport-only here; retain immutability and every routing modifier. */
  compress(_compress: boolean): BroadcastOperator {
    return this.narrow(this.targetRooms, this.exceptRooms);
  }

  /**
   * Return a new operator with the volatile delivery flag. The getter never mutates
   * the narrowed operator it was read from, and it carries any timeout already set.
   */
  get volatile(): BroadcastOperator {
    return new BroadcastOperator(
      this.adapter,
      this.sockets,
      this.targetRooms,
      this.exceptRooms,
      true,
      this.timeoutMs,
    );
  }

  /**
   * Resolve this broadcast's recipients: empty target rooms means "everyone" (`io.emit` /
   * `socket.broadcast`), otherwise the deduped union of the target rooms' members, minus the
   * except rooms (the sender's id-room for the `socket.*` forms). A volatile broadcast also
   * skips a recipient still in its pre-connect window (0016).
   */
  private recipients(): { recipients: ServerSocket[]; excluded: Set<string> } {
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
      if (this.isVolatile && !socket.connected) continue;
      out.push(socket);
    }
    return { recipients: out, excluded };
  }

  /** Record the one final routing snapshot before acknowledgement or delivery work begins. */
  private trace(event: string, recipients: readonly ServerSocket[], excluded: Set<string>): void {
    if (!this.adapter.traceBroadcast) return;
    const trace = Object.freeze({
      event,
      rooms: Object.freeze([...this.targetRooms]),
      exceptRooms: Object.freeze([...this.exceptRooms]),
      excluded: Object.freeze([...excluded]),
      recipients: Object.freeze(recipients.map((socket) => socket.id)),
      volatile: this.isVolatile,
    });
    this.adapter.traceBroadcast(trace);
  }

  emit(event: string, ...args: unknown[]): boolean {
    assertNotReservedEvent(event);
    const last = args.at(-1);
    const ack = typeof last === 'function' ? (last as (...a: unknown[]) => void) : undefined;
    const data = ack ? args.slice(0, -1) : args;
    // Socket.IO encodes one broadcast packet before recipient observation, even
    // when routing resolves to nobody (0026). Each recipient decodes it separately.
    const payload = encodePayload(data);
    const { recipients, excluded } = this.recipients();
    this.trace(event, recipients, excluded);
    // A trailing callback always collects one ack per recipient. With no explicit
    // timeout, Socket.IO still arms setTimeout(undefined), so immediate acknowledgements
    // race the zero-delay timer instead of waiting indefinitely.
    if (typeof last !== 'function') {
      for (const socket of recipients) socket.sendBroadcast(event, args, payload, ack);
      return true;
    }
    this.collect(
      event,
      data,
      payload,
      last as (...a: unknown[]) => void,
      recipients,
      this.timeoutMs,
    );
    return true;
  }

  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.emit(event, ...args, (error: unknown, responses: unknown[]) => {
        if (error) {
          Object.assign(error as object, { responses });
          reject(error);
          return;
        }
        resolve(responses);
      });
    });
  }

  /**
   * Fan `event` out to `recipients` and gather their acks (#112). The callback fires once:
   * `(null, responses)` when every recipient answers before `ms`, or `(Error('operation has
   * timed out'), responses)` when the timer wins, where `responses` holds the acks that
   * arrived, in arrival order (measured on 4.7.5 and 4.8.3, not join order). A `settled`
   * flag keeps the callback single-shot. A late ack may still append to the already exposed
   * response array, matching Socket.IO's collector. No recipient resolves at once as
   * `(null, [])`.
   */
  private collect(
    event: string,
    data: unknown[],
    payload: EncodedPayload,
    callback: (...received: unknown[]) => void,
    recipients: ServerSocket[],
    ms: number | undefined,
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
      const answer = (...received: unknown[]) => {
        responses.push(received[0]);
        if (settled) return;
        remaining -= 1;
        if (remaining === 0) {
          settled = true;
          clearTimeout(timer);
          callback(null, responses);
        }
      };
      socket.sendBroadcast(event, [...data, answer], payload, answer);
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
   * This namespace's routing seam: the built-in `Adapter`, or the custom instance
   * installed during server setup through `Server.adapter`.
   */
  adapter: SmocketAdapter;
  /** Server sockets connected here but not yet claimed by a `nextConnection`. */
  private readonly ready: ServerSocket[] = [];
  /**
   * Handlers registered through `on`, keyed by event. This is the app-facing entry
   * point: `io.on('connection', cb)` wires per-socket handlers, and each is fired
   * with the new server socket as the pairing completes. The `nextConnection` path
   * resolves the same socket; the two are the two ways to reach a
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
  /** Once closed, no pending or later pairing may enter this namespace. */
  private closed: boolean;

  constructor(
    readonly name: string,
    /** The server's normalized origin, filled into each socket's `handshake.url` (0006). */
    private readonly origin: string,
    closed = false,
  ) {
    this.closed = closed;
    this.adapter = new Adapter();
  }

  /** Install the adapter instance prepared for this namespace during server setup. */
  useAdapter(adapter: SmocketAdapter): void {
    this.adapter = adapter;
  }

  /** Copy a dynamic parent's setup once, when this concrete child is created. */
  inherit(
    middleware: readonly ConnectionMiddleware[],
    listeners: ReadonlyMap<string, readonly Listener[]>,
  ): void {
    this.middleware.push(...middleware);
    for (const [event, entries] of listeners) {
      this.connectionListeners.set(event, [...entries]);
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
   * Register a namespace-level handler. Only the connection events have a source in
   * the mock (0000): `connection`, and `connect` as its synonym, are the app entry
   * point that hands over each new server socket. Real socket.io fires both, so an
   * app listening on either works. Other events are accepted but never fire, since a
   * mock has nothing else to raise here.
   */
  on(event: string, listener: Listener): this {
    if (event === 'connection' || event === 'connect') {
      addListener(this.connectionListeners, event, listener);
    }
    return this;
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
}

/** Broadcast view over the concrete children currently owned by one dynamic parent. */
class ParentBroadcastOperator implements BroadcastContract, TimeoutBroadcastContract {
  constructor(
    private readonly children: ReadonlySet<Namespace>,
    private readonly rooms: readonly string[] = [],
    private readonly exceptRooms: readonly string[] = [],
    private readonly timeoutMs?: number,
    private readonly isVolatile = false,
  ) {}

  to(room: string | string[]): ParentBroadcastOperator {
    return new ParentBroadcastOperator(
      this.children,
      [...this.rooms, ...asRooms(room)],
      this.exceptRooms,
      this.timeoutMs,
      this.isVolatile,
    );
  }
  in(room: string | string[]): ParentBroadcastOperator {
    return this.to(room);
  }
  except(room: string | string[]): ParentBroadcastOperator {
    return new ParentBroadcastOperator(
      this.children,
      this.rooms,
      [...this.exceptRooms, ...asRooms(room)],
      this.timeoutMs,
      this.isVolatile,
    );
  }
  timeout(ms: number): ParentBroadcastOperator {
    return new ParentBroadcastOperator(
      this.children,
      this.rooms,
      this.exceptRooms,
      ms,
      this.isVolatile,
    );
  }
  compress(_compress: boolean): ParentBroadcastOperator {
    return new ParentBroadcastOperator(
      this.children,
      this.rooms,
      this.exceptRooms,
      this.timeoutMs,
      this.isVolatile,
    );
  }
  get volatile(): ParentBroadcastOperator {
    return new ParentBroadcastOperator(
      this.children,
      this.rooms,
      this.exceptRooms,
      this.timeoutMs,
      true,
    );
  }
  emit(event: string, ...args: unknown[]): boolean {
    for (const child of this.children) {
      new BroadcastOperator(
        child.adapter,
        child.sockets,
        this.rooms,
        this.exceptRooms,
        this.isVolatile,
        this.timeoutMs,
      ).emit(event, ...args);
    }
    return true;
  }

  /**
   * Direct parent Promise acknowledgement broadcasts resolve `[]` without reaching
   * concrete children in both supported minors. Narrowed parent delivery stays outside
   * the broader conformance claim under 0029.
   */
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve) => {
      assertNotReservedEvent(event);
      void args;
      resolve([]);
    });
  }
}

/** A hidden dynamic parent whose public operations fan out over concrete children. */
class ParentNamespace implements NamespaceContract {
  readonly adapter: SmocketAdapter = new Adapter();
  readonly children = new Set<Namespace>();
  readonly middleware: ConnectionMiddleware[] = [];
  readonly connectionListeners = new Map<string, Listener[]>();

  constructor(
    readonly name: string,
    private readonly matcher: RegExp | ParentNspNameMatchFn,
  ) {}

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
    child.inherit(this.middleware, this.connectionListeners);
    this.children.add(child);
  }

  use(middleware: ConnectionMiddleware): this {
    this.middleware.push(middleware);
    return this;
  }
  on(event: string, listener: Listener): this {
    if (event === 'connection' || event === 'connect') {
      addListener(this.connectionListeners, event, listener);
    }
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
}

/**
 * The origin registry: normalized origin -> the `Server` listening there. Every
 * `new Server(url)` registers itself here and every `connect(url)` resolves through
 * it, so the required url and this map are the one decision (0003). A module-level
 * singleton, cleared between tests through `resetRegistry`.
 */
const servers = new Map<string, Server>();

/** Socket.IO's static namespace key: root for empty, otherwise add a leading slash if absent. */
function normalizeNamespace(name: string): string {
  if (name === '' || name === '/') return '/';
  return name.startsWith('/') ? name : `/${name}`;
}

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
  return server.connect(namespace, {
    auth: options?.auth,
    query,
    forceNew: options?.forceNew,
    multiplex: options?.multiplex,
  });
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

// `SmocketServer` rather than `ServerContract`, so the wider interface an application
// annotates with is checked against this class rather than trusted to stay in step.
export class Server<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> implements SmocketServer<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
  /**
   * This server's normalized origin, its key in the module `servers` registry.
   * Private: it is internal bookkeeping with no counterpart on real socket.io, so
   * it stays off the public surface rather than becoming an undocumented addition.
   */
  private readonly origin: string;
  /**
   * The namespace registry. Every connection, room and broadcast lives on a
   * `Namespace`; the server is the front door that routes to one. `of` is
   * get-or-create and returns the *same* normalized `Namespace` on repeat calls.
   * Admission only reads this registry, so a client cannot create a namespace.
   */
  private readonly namespaces = new Map<string, Namespace>();
  /** Dynamic parents are tried in registration order for unregistered names. */
  private readonly parents: ParentNamespace[] = [];
  /** Manual child attachment uses the latest parent registered for each RegExp object. */
  private readonly regexParents = new Map<RegExp, ParentNamespace>();
  /** Server-only lifecycle listeners; ordinary connection listeners stay on `/`. */
  private readonly serverListeners = new Map<string, Listener[]>();
  /** `nextConnection(name)` observers waiting for a function-matched child to exist. */
  private readonly dynamicWaiters = new Map<string, Waiter[]>();
  /** The origin's reusable Manager; duplicate namespaces and opt-outs bypass it (0028). */
  private cachedManager: Manager | undefined;

  /**
   * The custom adapter factory registered through `adapter`, applied to every
   * namespace this server creates. Undefined until a caller registers one, in
   * which case each namespace uses the built-in `Adapter`.
   */
  private adapterFactory: AdapterFactory | undefined;
  /** Custom instances already assigned to namespaces, used to enforce isolation. */
  private readonly adapterInstances = new Set<SmocketAdapter>();
  /** Adapter registration closes as soon as any connection attempt begins. */
  private admissionStarted = false;
  /** Set before teardown starts, so no namespace created during or after close can accept. */
  private closed = false;
  /** The first close owns teardown; repeated calls return the same completed work. */
  private closePromise: Promise<void> | undefined;

  /**
   * The url is required, with no argument-less form: socket.io always takes a
   * connection target, so smocket does too rather than invent a rule for what an
   * unlabelled server means (0003). The url is normalized to an origin and the
   * server registers itself under it, so a later `connect(url)` naming the same
   * origin resolves back to this instance.
   */
  constructor(url: string) {
    this.origin = parseUrl(url).origin;
    // Socket.IO constructs the root namespace with the server. It is the one static
    // namespace a client may enter without an earlier public `of()` registration.
    this.getNamespace('/', undefined, false);
    servers.set(this.origin, this as Server);
  }

  /**
   * Register a custom [adapter](../docs/glossary.md#adapter) factory: smocket's
   * public routing seam. During setup the factory builds one fresh adapter per namespace,
   * replacing the built-in routing (which sids a broadcast targets) while delivery stays in
   * the core, so a custom adapter cannot break per-socket order (0010). This is a
   * smocket-only API with no socket.io-compatible counterpart (see
   * `docs/differences.md` §B). Registration closes at the first connection attempt.
   * Existing adapters change only after every replacement is built successfully.
   */
  adapter(factory: AdapterFactory<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): void {
    if (this.admissionStarted) {
      throw new Error('adapter must be registered before the first connection attempt');
    }
    const runtimeFactory = factory as AdapterFactory;
    const used = new Set(this.adapterInstances);
    const replacements = new Map<Namespace, SmocketAdapter>();
    for (const namespace of this.namespaces.values()) {
      const adapter = runtimeFactory(namespace);
      if (used.has(adapter)) {
        throw new Error('adapter factory must return a fresh instance for each namespace');
      }
      used.add(adapter);
      replacements.set(namespace, adapter);
    }
    for (const [namespace, adapter] of replacements) namespace.useAdapter(adapter);
    this.adapterFactory = runtimeFactory;
    this.adapterInstances.clear();
    for (const adapter of replacements.values()) this.adapterInstances.add(adapter);
  }

  /** Get the runtime namespace by name, creating it on first use. */
  private getNamespace(name: string, parent?: ParentNamespace, emitLifecycle = true): Namespace {
    const normalized = normalizeNamespace(name);
    const existing = this.namespaces.get(normalized);
    if (existing) return existing;
    const attachTo = parent ?? this.matchingRegExpParent(normalized);
    const namespace = new Namespace(normalized, this.origin, this.closed);
    if (this.adapterFactory) {
      const adapter = this.adapterFactory(namespace);
      if (this.adapterInstances.has(adapter)) {
        throw new Error('adapter factory must return a fresh instance for each namespace');
      }
      namespace.useAdapter(adapter);
      this.adapterInstances.add(adapter);
    }
    attachTo?.addChild(namespace);
    this.namespaces.set(normalized, namespace);
    const waiters = this.dynamicWaiters.get(normalized);
    if (waiters) {
      this.dynamicWaiters.delete(normalized);
      for (const waiter of waiters) {
        void namespace.nextConnection().then(waiter.resolve, waiter.reject);
      }
    }
    if (emitLifecycle && normalized !== '/') this.emitNewNamespace(namespace);
    return namespace;
  }

  /** A manual concrete lookup attaches only to a RegExp parent, as Socket.IO does. */
  private matchingRegExpParent(name: string): ParentNamespace | undefined {
    return [...this.regexParents.values()].find((parent) => parent.matchesSynchronously(name));
  }

  private emitNewNamespace(namespace: Namespace): void {
    const listeners = this.serverListeners.get('new_namespace');
    if (!listeners) return;
    for (const listener of [...listeners]) {
      (listener as (nsp: Namespace) => void)(namespace);
    }
  }

  /** Register or read a normalized static namespace (socket.io's lazy `of`). */
  of(
    name: string | RegExp | ParentNspNameMatchFn,
    listener?: (
      socket: ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    ) => void,
  ): NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
    if (typeof name !== 'string') {
      const parent = new ParentNamespace(`/_${this.parents.length}`, name);
      this.parents.push(parent);
      if (name instanceof RegExp) this.regexParents.set(name, parent);
      if (listener) parent.on('connection', listener as Listener);
      return parent as NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
    }
    return this.getNamespace(name) as NamespaceContract<
      ListenEvents,
      EmitEvents,
      ServerSideEvents,
      SocketData
    >;
  }

  /**
   * The server's `on` is the default namespace's: `io.on('connection')` is exactly
   * `io.of('/').on('connection')`, socket.io's primary server entry point, so it
   * wires handlers for connections on `/` and never sees another namespace's.
   */
  on<
    Event extends ReservedOrUserEventName<
      ServerReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      SupportedServerListenerEvents<ServerSideEvents>
    >,
  >(
    event: Event,
    listener: ReservedOrUserListener<
      ServerReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      SupportedServerListenerEvents<ServerSideEvents>,
      Event
    >,
  ): void {
    if (event === 'new_namespace') {
      addListener(this.serverListeners, event, listener as Listener);
      return;
    }
    this.getNamespace('/').on(event, listener as Listener);
  }

  /**
   * The server's `use` is the default namespace's: `io.use(fn)` registers a connection
   * middleware for connections on `/`, exactly `io.of('/').use(fn)`, socket.io's primary
   * place to authenticate a connection. Middleware on another namespace is registered
   * through `io.of(name).use(fn)`.
   */
  use(
    middleware: ConnectionMiddleware<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ): this {
    this.getNamespace('/').use(middleware as ConnectionMiddleware);
    return this;
  }

  /**
   * Attach a client to an already registered `namespace` (`/` by default); see
   * `Namespace.connect`. `source` carries the caller's `auth` / `query` onto the
   * connection's handshake. An unregistered name reports `Invalid namespace`
   * without creating registry or adapter state.
   */
  connect(
    namespace = '/',
    source?: ConnectOptions,
  ): ClientSocketContract<EmitEvents, ListenEvents> {
    this.admissionStarted = true;
    const normalized = normalizeNamespace(namespace);
    const manager = this.managerFor(normalized, source);
    const registered = this.namespaces.get(normalized);
    if (!registered) {
      const client = new ClientSocket(
        manager,
        undefined,
        source,
        () => this.namespaces.get(normalized),
        (retryingClient) => this.admitDynamic(retryingClient, normalized, source),
      );
      if (this.parents.length === 0) client.failInvalidNamespace();
      else this.admitDynamic(client, normalized, source);
      return client as ClientSocketContract<EmitEvents, ListenEvents>;
    }
    return registered.connect(manager, source) as ClientSocketContract<EmitEvents, ListenEvents>;
  }

  /** Resolve auth once, then try dynamic parents in registration order. */
  private admitDynamic(client: ClientSocket, name: string, source?: ConnectOptions): void {
    const attempt = client.beginConnectionAttempt();
    if (!attempt) return;
    resolveAuth(source?.auth, (auth) => {
      if (!client.isConnectionAttemptPending(attempt)) return;
      const tryParent = (index: number): void => {
        const parent = this.parents[index];
        if (!parent) {
          client.rejectConnectionAttempt(attempt, new Error('Invalid namespace'));
          return;
        }
        parent.matches(name, auth, (allowed) => {
          if (!allowed) {
            tryParent(index + 1);
            return;
          }
          let child: Namespace;
          try {
            child = this.getNamespace(name, parent);
          } catch (error) {
            client.rejectConnectionAttempt(
              attempt,
              error instanceof Error ? error : new Error(String(error)),
            );
            return;
          }
          if (!client.isConnectionAttemptPending(attempt)) return;
          client.attachNamespace(child);
          child.continuePair(client, attempt, { ...source, auth });
        });
      };
      tryParent(0);
    });
  }

  /** Apply socket.io-client's supported cached-Manager lookup boundary (0028). */
  private managerFor(namespace: string, source?: ConnectOptions): Manager {
    if (source?.forceNew || source?.multiplex === false) return new Manager(namespace);
    if (!this.cachedManager) {
      this.cachedManager = new Manager(namespace);
      return this.cachedManager;
    }
    if (this.cachedManager.owns(namespace)) return new Manager(namespace);
    this.cachedManager.claim(namespace);
    return this.cachedManager;
  }

  /** Resolve with the server socket of the next client to connect on `namespace`. */
  nextConnection(
    namespace = '/',
  ): Promise<ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> {
    if (this.closed) return Promise.reject(serverClosedError());
    const normalized = normalizeNamespace(namespace);
    const concrete = this.namespaces.get(normalized);
    if (concrete) {
      return concrete.nextConnection() as Promise<
        ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
      >;
    }
    const regexpParent = this.matchingRegExpParent(normalized);
    if (!regexpParent && this.parents.length > 0) {
      return new Promise<ServerSocket>((resolve, reject) => {
        const waiters = this.dynamicWaiters.get(normalized) ?? [];
        waiters.push({ resolve, reject });
        this.dynamicWaiters.set(normalized, waiters);
      }) as Promise<ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>>;
    }
    return this.getNamespace(normalized, regexpParent).nextConnection() as Promise<
      ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
    >;
  }

  // The server's own broadcast surface is the default namespace's: `io.emit()` is
  // exactly `io.of('/').emit()`, so "everyone" means everyone on `/` and never
  // reaches another namespace. Each form delegates rather than reimplements.
  emit<Event extends EventNameWithoutAck<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean {
    return this.getNamespace('/').emit(event, ...args);
  }
  send(...args: MessageEventParams<EmitEvents>): this {
    this.getNamespace('/').send(...args);
    return this;
  }
  write(...args: MessageEventParams<EmitEvents>): this {
    this.getNamespace('/').write(...args);
    return this;
  }
  to(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData> {
    return this.getNamespace('/').to(room) as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  in(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData> {
    return this.getNamespace('/').in(room) as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  except(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData> {
    return this.getNamespace('/').except(room) as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  timeout(
    ms: number,
  ): TimeoutBroadcastContract<
    DecorateAcknowledgements<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>>,
    SocketData
  > {
    // `io.timeout(ms)` is the default namespace's: `io.timeout(ms).to(room)` reaches only `/`.
    return this.getNamespace('/').timeout(ms) as TimeoutBroadcastContract<
      DecorateAcknowledgements<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>>,
      SocketData
    >;
  }
  compress(
    _compress: boolean,
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData> {
    return this.getNamespace('/').compress(_compress) as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  get volatile(): BroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  > {
    // `io.volatile` is the default namespace's: `io.volatile.to(room)` reaches only `/`.
    return this.getNamespace('/').volatile as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }

  /**
   * Shut down this server, matching socket.io's observable socket lifecycle. The
   * registry deletion is conditional: constructing a newer server for the same
   * origin replaces this one, and closing the old object must not unregister the
   * replacement. Timers already armed by an acknowledgement are deliberately left
   * alone, as real socket.io does (#193, 0020).
   */
  close(fn?: (err?: Error) => void): Promise<void> {
    const alreadyClosing = this.closed;
    this.closed = true;
    if (servers.get(this.origin) === this) servers.delete(this.origin);
    for (const waiters of this.dynamicWaiters.values()) {
      for (const waiter of waiters) waiter.reject(serverClosedError());
    }
    this.dynamicWaiters.clear();
    this.closePromise ??= Promise.all(
      [...this.namespaces.values()].map((namespace) => namespace.close()),
    ).then(() => undefined);
    if (fn) {
      void this.closePromise.then(() => {
        if (!alreadyClosing) return fn();

        const error = new Error('Server is not running.') as Error & { code: string };
        error.code = 'ERR_SERVER_NOT_RUNNING';
        fn(error);
      });
    }
    return this.closePromise;
  }
}

/**
 * Socket.IO's public-emit reserved names. The four lifecycle names are dispatched
 * locally by smocket and skipped by catch-alls; the final two belong to Node's emitter.
 * Application emit paths reject the whole set before observation or delivery.
 */
const RESERVED_EVENTS = new Set([
  'connect',
  'connect_error',
  'disconnect',
  'disconnecting',
  'newListener',
  'removeListener',
]);

/** Reject names Socket.IO reserves for its own emitter and connection lifecycle. */
function assertNotReservedEvent(event: string): void {
  if (RESERVED_EVENTS.has(event)) {
    throw new Error(`"${event}" is a reserved event name`);
  }
}

/**
 * A minimal event target shared by both socket sides: a listener registry, the
 * `on`/`once` the tests register through, and `dispatch`, which fires this
 * side's own listeners. Delivery from the peer goes through `send`, which calls
 * the target's `dispatch` a tick later.
 */
class Emitter {
  /** Ordinary named listeners. Catch-all registries intentionally stay separate. */
  protected readonly eventListeners = new Map<OrdinaryEventName, Listener[]>();
  /** Catch-all listeners, fired for every non-reserved event before the specific ones. */
  private anyListeners: AnyListener[] | undefined;
  /** Outgoing catch-all listeners, fired for every event this socket sends (#111). */
  private anyOutgoingListeners: AnyListener[] | undefined;

  on(event: string, listener: Listener): this {
    addListener(this.eventListeners, event, listener);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapper = ((...args: never[]) => {
      removeOrdinaryListener(this.eventListeners, event, wrapper);
      listener(...args);
    }) as Listener;
    // component-emitter exposes this wrapper through `listeners()` and carries the
    // original on `.fn`. The server overrides `once` with Node's `.listener` shape.
    (wrapper as { fn?: Listener }).fn = listener;
    addListener(this.eventListeners, event, wrapper);
    return this;
  }

  onAny(listener: AnyListener): this {
    (this.anyListeners ??= []).push(listener);
    return this;
  }

  prependAny(listener: AnyListener): this {
    (this.anyListeners ??= []).unshift(listener);
    return this;
  }

  listenersAny(): AnyListener[] {
    return this.anyListeners ?? [];
  }

  offAny(listener?: AnyListener): this {
    // Remove the first matching registration, the way `off` removes one specific
    // listener; with no argument, replace the backing array so earlier lookups detach.
    // socket.io's `offAny` splices the first occurrence out of `_anyListeners` (#125).
    if (listener) removeFirst(this.anyListeners, listener);
    else if (this.anyListeners) this.anyListeners = [];
    return this;
  }

  onAnyOutgoing(listener: AnyListener): this {
    (this.anyOutgoingListeners ??= []).push(listener);
    return this;
  }

  prependAnyOutgoing(listener: AnyListener): this {
    (this.anyOutgoingListeners ??= []).unshift(listener);
    return this;
  }

  listenersAnyOutgoing(): AnyListener[] {
    return this.anyOutgoingListeners ?? [];
  }

  offAnyOutgoing(listener?: AnyListener): this {
    // The outgoing catch-all's removal mirrors `offAny` (#111): drop the first match,
    // or replace the backing array with no argument.
    if (listener) removeFirst(this.anyOutgoingListeners, listener);
    else if (this.anyOutgoingListeners) this.anyOutgoingListeners = [];
    return this;
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
    if (!this.anyOutgoingListeners?.length || RESERVED_EVENTS.has(event)) return;
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
    removeOrdinaryListener(this.eventListeners, event, listener);
  }

  /**
   * The server's counterpart to `removeOne`: Node's emitter removes the last
   * matching registration, not the first, so a doubly-registered listener drops
   * its most recent registration first. Same match rule (direct or `once`
   * wrapper), scanned from the end.
   */
  protected removeLast(event: string, listener: Listener): void {
    removeOrdinaryListener(this.eventListeners, event, listener, true);
  }

  /** Clear every listener for `event`, or every listener on the socket with no argument. */
  removeAllListeners(event?: string): this {
    if (event === undefined) this.eventListeners.clear();
    else this.eventListeners.delete(event);
    return this;
  }

  /**
   * Schedule one inbound delivery to this socket. The default is the shared next-tick
   * `defer`, which the server socket keeps (a client-to-server emit is never delayed).
   * `ClientSocket` overrides it to consult its namespace adapter's optional
   * delivery-scheduling hook (#78), so a delay applies to the client-inbound stream while
   * its order is preserved. Called by `send`.
   */
  scheduleReceive(deliver: () => void): void {
    defer(deliver);
  }

  /**
   * Fire this side's listeners for `event`. Internal; the peer's `send` calls it.
   * A catch-all runs first and receives the event name ahead of the args, for
   * every event except the reserved lifecycle ones, which are dispatched locally
   * rather than received from the peer.
   */
  dispatch(event: string, args: unknown[]): void {
    if (this.anyListeners?.length && !RESERVED_EVENTS.has(event)) {
      for (const any of [...this.anyListeners]) {
        (any as (...a: unknown[]) => void)(event, ...args);
      }
    }
    const list = this.eventListeners.get(event);
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
  /** component-emitter returns the stable backing array while this key exists. */
  listeners = ((event: string) =>
    (this.eventListeners.get(event) ?? []) as AnyListener[]) as ClientSocketContract['listeners'];

  /** component-emitter derives this directly from the current live-array length. */
  hasListeners = ((event: string) =>
    this.listeners(event).length > 0) as ClientSocketContract['hasListeners'];

  off(event?: string, listener?: Listener): this {
    if (event === undefined) {
      this.removeAllListeners();
    } else if (listener === undefined) {
      this.removeAllListeners(event);
    } else {
      this.removeOne(event, listener);
    }
    return this;
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
  /** The first teardown owns the lifecycle; later disconnect paths await the same work. */
  private teardownPromise: Promise<void> | undefined;
  /** False once this server-side socket begins its disconnect lifecycle. */
  private active = true;
  /** Cleared by whole-socket cleanup so a disconnected socket cannot recreate membership. */
  private acceptsRoomJoins = true;
  /** Guards the adapter's whole-socket removal signal across competing teardown paths. */
  private membershipCleaned = false;
  /**
   * The per-socket store (#108): an empty object at creation that middleware writes and a
   * handler reads, to carry what middleware resolved from the handshake. A fresh socket
   * gets a fresh object, so a reconnection (a new socket, 0013) starts empty, which ties
   * `data` to the socket rather than the client identity, matching real socket.io.
   */
  readonly data: Record<string, unknown> = {};
  private peer!: ClientSocket;
  /** Socket.IO modifiers are pending state on the socket, consumed by one operation. */
  private flags: SocketFlags = {};

  constructor(id: string, nsp: Namespace, handshake: Handshake) {
    super();
    this.id = id;
    this.nsp = nsp;
    this.handshake = handshake;
    // Socket.IO installs one noop `error` listener on every fresh server socket.
    // It is ordinary emitter state: public removal can delete it like any other key.
    this.on('error', () => {});
  }

  /** Node returns a fresh snapshot and unwraps `once` registrations to their originals. */
  listeners = ((event: string) =>
    (this.eventListeners.get(event) ?? []).map(
      (entry) => (entry as { listener?: Listener }).listener ?? entry,
    ) as AnyListener[]) as ServerSocketContract['listeners'];

  /** Count every registration, or only direct and original `once` identity matches. */
  listenerCount = ((event: OrdinaryEventName, listener?: Listener) => {
    const entries = this.eventListeners.get(event) ?? [];
    return listener === undefined
      ? entries.length
      : entries.filter(
          (entry) => entry === listener || (entry as { listener?: Listener }).listener === listener,
        ).length;
  }) as ServerSocketContract['listenerCount'];

  /** Map key order matches Node's insertion order, including delete and re-add. */
  eventNames(): (string | symbol)[] {
    return [...this.eventListeners.keys()];
  }

  /** Server `once` uses Node's wrapper shape, which `listeners()` unwraps. */
  override once(event: string, listener: Listener): this {
    const wrapper = ((...args: never[]) => {
      removeOrdinaryListener(this.eventListeners, event, wrapper, true);
      listener(...args);
    }) as Listener;
    (wrapper as { listener?: Listener }).listener = listener;
    addListener(this.eventListeners, event, wrapper);
    return this;
  }

  /** Wire the paired client in; called by `Namespace.pair` before completion. */
  attachPeer(client: ClientSocket): void {
    this.peer = client;
  }

  /**
   * Server-side teardown for a disconnecting socket, one tick later through the same
   * `defer` a server-inbound emit uses. A client-to-server emit sent just before disconnect
   * is already queued on that same next tick, so deferring the teardown lets it arrive
   * before the socket leaves its rooms, keeping the per-socket FIFO invariant the marker
   * proofs rely on. (A `DelayingAdapter` only slows the client-inbound stream, never this
   * one, so it does not disturb this ordering. Whole-socket cleanup drains its queued
   * client-inbound deliveries before the socket leaves the namespace roster.)
   *
   * `disconnecting` fires while the rooms are still intact, so a handler can read
   * and notify them; `disconnect` fires once they are gone. Both carry `reason`,
   * the string real socket.io reports on this side (pinned in the tests).
   */
  private teardown(reason: string): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise;
    this.teardownPromise = new Promise((resolve) => {
      defer(() => {
        this.active = false;
        this.dispatch('disconnecting', [reason]);
        this.cleanupMembership();
        this.dispatch('disconnect', [reason]);
        resolve();
      });
    });
    return this.teardownPromise;
  }

  /**
   * Remove every trace a connection middleware could have created before admission.
   * This path deliberately emits no lifecycle event: Socket.IO does not report a server
   * `disconnect` for a socket that never connected. `cleanupMembership` is idempotent,
   * so cancellation and a later middleware callback can both reach it safely.
   */
  cleanupConnectionAttempt(): void {
    this.active = false;
    this.cleanupMembership();
  }

  /** Whole-socket membership cleanup shared by abandoned attempts and disconnect. */
  private cleanupMembership(): void {
    if (this.membershipCleaned) return;
    this.membershipCleaned = true;
    this.acceptsRoomJoins = false;
    for (const room of this.rooms) this.nsp.adapter.del(this.id, room);
    // `del` removes one room and intentionally leaves the sid entry alone. Whole-socket
    // cleanup owns the reverse-index deletion, matching socket.io-adapter's `delAll`
    // without adding that still-undecided method to smocket's public adapter seam (#238).
    this.nsp.adapter.sids.delete(this.id);
    this.nsp.adapter.removeSocket?.(this.id);
    // Empty the live Set in place (contract: "emptied in place on teardown")
    // rather than replacing it, so any held reference sees it clear.
    this.rooms.clear();
    // A pending socket is not registered yet, but deleting is harmless and keeps this
    // primitive complete when it is shared with connected-socket teardown.
    this.nsp.sockets.delete(this.id);
  }

  /**
   * A client-initiated disconnect (`client.disconnect()`) reaching the server
   * side. The client already reported `io client disconnect` on its own side; the
   * server reports `client namespace disconnect`, real socket.io's reason here.
   */
  handleDisconnect(): void {
    void this.teardown('client namespace disconnect');
  }

  /** Server-wide close: transport loss on the client, shutdown lifecycle here. */
  async closeFromServer(): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise;
    await this.teardown('server shutting down');
    if (this.peer.connected) this.peer.markDisconnected('transport close');
  }

  /**
   * Server-initiated disconnect, socket.io's `socket.disconnect(close?)`. With
   * `true`, the logical Manager applies this lifecycle to every connected namespace;
   * otherwise only this socket closes (0028). There is still no transport here.
   */
  disconnect(_close?: boolean): this {
    if (_close) {
      if (this.peer.ownsConnection(this)) this.peer.io.disconnect(this);
      return this;
    }
    this.disconnectNamespaceFromServer();
    return this;
  }

  /** Server-side lifecycle is synchronous; the corresponding client event is deferred. */
  disconnectNamespaceFromServer(): void {
    if (!this.teardownSynchronously('server namespace disconnect')) return;
    defer(() => {
      if (this.peer.connected) this.peer.markDisconnected('io server disconnect');
    });
  }

  private teardownSynchronously(reason: string): boolean {
    if (this.teardownPromise) return false;
    this.teardownPromise = Promise.resolve();
    this.active = false;
    this.dispatch('disconnecting', [reason]);
    this.cleanupMembership();
    this.dispatch('disconnect', [reason]);
    return true;
  }

  /** Whether Manager-wide teardown may still originate from this server socket. */
  isActive(): boolean {
    return this.active;
  }

  emit(event: string, ...args: unknown[]): boolean {
    assertNotReservedEvent(event);
    const flags = this.consumeFlags();
    const { args: deliveredArgs } = withAckTimeout(args, flags.timeout);
    if (flags.volatile && !this.peer.connected) return true;
    this.emitOutgoing(event, args);
    send(this.peer, event, deliveredArgs);
    return true;
  }
  send(...args: unknown[]): this {
    this.emit('message', ...args);
    return this;
  }
  write(...args: unknown[]): this {
    return this.send(...args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    const withError = this.flags.timeout !== undefined;
    return new Promise((resolve, reject) => {
      this.emit(event, ...args, (first: unknown, second: unknown) => {
        if (withError) {
          if (first) reject(first);
          else resolve(second);
        } else {
          resolve(first);
        }
      });
    });
  }

  /**
   * Deliver one already-encoded broadcast packet to this socket's client. The
   * outgoing listener intentionally sees the shared live source after encoding,
   * while the client receives its own decode of the frozen packet (0026).
   */
  sendBroadcast(
    event: string,
    sourceArgs: unknown[],
    payload: EncodedPayload,
    ack?: (...answer: unknown[]) => void,
  ): void {
    this.emitOutgoing(event, sourceArgs);
    sendEncoded(this.peer, event, payload, ack);
  }
  /**
   * Arm a timeout flag on this same socket. The next direct emit consumes it, or the next
   * `to` / `broadcast` / `except` transfers it into an ack-collecting operator (#112).
   */
  timeout(ms: number): ServerSocket {
    this.flags.timeout = ms;
    return this;
  }

  /** Compression affects transport packet options upstream; the fluent logic surface remains. */
  compress(_compress: boolean): this {
    return this;
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
   * Arm a volatile flag on this same socket (0016). The next direct emit consumes it, or
   * the next broadcast-operator creation transfers it into that operator.
   */
  get volatile(): this {
    this.flags.volatile = true;
    return this;
  }

  /**
   * The server socket is Node's `EventEmitter`, whose `off` (`removeListener`)
   * requires a listener: `off(event)` with none throws rather than clearing the
   * event, so bulk removal here is `removeAllListeners` (0017).
   */
  off(event: string, listener: Listener): this {
    if (typeof listener !== 'function') {
      throw new TypeError('The "listener" argument must be of type function. Received undefined');
    }
    this.removeLast(event, listener);
    return this;
  }

  get broadcast(): BroadcastContract {
    // Everyone except the sender: no target rooms, except the sender's own id-room.
    return this.newBroadcastOperator([], [this.id]);
  }
  join(room: string | string[]): void {
    if (!this.acceptsRoomJoins) return;
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
    return this.newBroadcastOperator(asRooms(room), [this.id]);
  }
  in(room: string | string[]): BroadcastContract {
    return this.to(room);
  }
  except(room: string | string[]): BroadcastContract {
    // Everyone except both the named room's members and the sender: no target
    // rooms, except the given rooms plus the sender's own id-room.
    return this.newBroadcastOperator([], [...asRooms(room), this.id]);
  }

  /** Move pending modifiers into one newly-created operator, then clear the socket. */
  private newBroadcastOperator(
    rooms: Iterable<string>,
    except: Iterable<string>,
  ): BroadcastOperator {
    const flags = this.consumeFlags();
    return new BroadcastOperator(
      this.nsp.adapter,
      this.nsp.sockets,
      rooms,
      except,
      flags.volatile,
      flags.timeout,
    );
  }

  /** Snapshot and clear modifiers atomically, giving them a one-operation lifetime. */
  private consumeFlags(): SocketFlags {
    const flags = this.flags;
    this.flags = {};
    return flags;
  }
}

export class ClientSocket extends ClientEmitter implements ClientSocketContract {
  connected = false;
  id: string | undefined;
  /** The shared Manager stand-in; compared only by identity across namespaces. */
  readonly io: Manager;
  /**
   * The namespace this client is attached to. Held so `connect` (a reconnect) can
   * re-pair on the same namespace without routing through the dead server socket.
   */
  private nsp: Namespace | undefined;
  /**
   * The current paired server socket. Assigned at `completeConnection`, not at
   * construction, and not readonly: a reconnect swaps in a new socket with a new
   * id, since the id belongs to one connection, not to the client.
   */
  private serverSocket!: ServerSocket;
  /** The only pairing still allowed to reach `connection` for this client. */
  private connectionAttempt: ConnectionAttempt | undefined;
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
  /** Socket.IO modifiers are pending state on the socket and consumed by one emit. */
  private flags: SocketFlags = {};
  /**
   * The caller's `auth` / `query`, held so a reconnect (`connect`) can rebuild the
   * same handshake on its fresh server socket, the way socket.io-client resends the
   * connection's auth and query on every reattach.
   */
  private readonly handshakeSource?: ConnectOptions;
  /**
   * Re-read a namespace after `Invalid namespace`. Socket.IO lets the same client
   * connect manually once the server registers that static name.
   */
  private readonly resolveNamespace?: () => Namespace | undefined;
  /** Re-run parent admission after an `Invalid namespace` result. */
  private readonly dynamicAdmission?: (client: ClientSocket) => void;

  constructor(
    manager: Manager,
    nsp: Namespace | undefined,
    source?: ConnectOptions,
    resolveNamespace?: () => Namespace | undefined,
    dynamicAdmission?: (client: ClientSocket) => void,
  ) {
    super();
    this.io = manager;
    this.nsp = nsp;
    this.handshakeSource = source;
    this.resolveNamespace = resolveNamespace;
    this.dynamicAdmission = dynamicAdmission;
  }

  /** Bind an admitted dynamic client to the one cached concrete child. */
  attachNamespace(namespace: Namespace): void {
    this.nsp = namespace;
  }

  /**
   * Server accepted us on `serverSocket`: adopt it and its id, fire `connect`,
   * then flush buffered emits to it. On a reconnect this is a new socket and id,
   * and flushing after the swap sends the buffer (emits made while disconnected)
   * to the new socket, matching socket.io-client.
   */
  completeConnectionAttempt(attempt: ConnectionAttempt, serverSocket: ServerSocket): void {
    if (!this.isConnectionAttemptPending(attempt)) {
      if (attempt.state !== 'connected') serverSocket.cleanupConnectionAttempt();
      return;
    }
    attempt.state = 'connected';
    this.connectionAttempt = undefined;
    this.serverSocket = serverSocket;
    this.connected = true;
    this.id = serverSocket.id;
    this.io.connected(this);
    const buffered = this.sendBuffer;
    this.sendBuffer = [];
    for (const [event, args] of buffered) {
      // socket.io-client does not observe or encode a buffered packet until the
      // connection flushes it. A listener mutation here therefore reaches the snapshot.
      this.emitOutgoing(event, args);
      send(this.serverSocket, event, args);
    }
    // The buffered packet is observed while the socket is already connected, but before
    // the public connect listener. Its named server listener still runs later through send.
    this.dispatch('connect', []);
  }

  /**
   * Deliveries to this client are what a delay affects (#78): the per-socket delay slows a
   * socket's client-inbound stream, keyed by the client's identity in the namespace, its
   * paired server socket's id. During the connect window the pairing is not complete yet
   * (`serverSocket` is unset), and an emit from a `connection` handler reaches here before
   * then, so that case falls back to the default next-tick with no delay.
   */
  override scheduleReceive(deliver: () => void): void {
    const paired: ServerSocket | undefined = this.serverSocket;
    if (paired) scheduleDelivery(paired.nsp.adapter, paired.id, deliver);
    else defer(deliver);
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
  rejectConnectionAttempt(attempt: ConnectionAttempt, err: MiddlewareError): void {
    if (!this.isConnectionAttemptPending(attempt)) return;
    attempt.state = 'rejected';
    attempt.serverSocket?.cleanupConnectionAttempt();
    this.connectionAttempt = undefined;
    this.io.settlePending(this);
    defer(() => this.dispatch('connect_error', [err]));
  }

  /** Report static namespace admission failure without making the client terminal. */
  failInvalidNamespace(): void {
    defer(() => this.dispatch('connect_error', [new Error('Invalid namespace')]));
  }

  /** Start one pairing, or reject a duplicate `connect()` while one is already pending. */
  beginConnectionAttempt(): ConnectionAttempt | undefined {
    if (this.connected || this.connectionAttempt?.state === 'pending') return undefined;
    const attempt: ConnectionAttempt = { state: 'pending' };
    this.connectionAttempt = attempt;
    this.io.registerPending(this);
    return attempt;
  }

  /** Attach the middleware-visible server socket to the still-current attempt. */
  attachConnectionAttempt(attempt: ConnectionAttempt, serverSocket: ServerSocket): boolean {
    if (!this.isConnectionAttemptPending(attempt) || attempt.serverSocket) return false;
    attempt.serverSocket = serverSocket;
    return true;
  }

  /** Whether a callback still belongs to the one attempt this client may complete. */
  isConnectionAttemptPending(attempt: ConnectionAttempt): boolean {
    return this.connectionAttempt === attempt && attempt.state === 'pending';
  }

  /** Whether `socket` is this client's current or connection-handler-visible pairing. */
  ownsConnection(socket: ServerSocket): boolean {
    if (!socket.isActive()) return false;
    return (
      (this.connected && this.serverSocket === socket) ||
      (this.connectionAttempt?.state === 'pending' &&
        this.connectionAttempt.serverSocket === socket)
    );
  }

  /** Cancel a pre-connect attempt without inventing client or server lifecycle events. */
  private cancelConnectionAttempt(): void {
    const attempt = this.connectionAttempt;
    if (!attempt || attempt.state !== 'pending') return;
    attempt.state = 'cancelled';
    attempt.serverSocket?.cleanupConnectionAttempt();
    this.connectionAttempt = undefined;
    this.io.settlePending(this);
  }

  /** Called by the Manager when its shared transport identity is closed. */
  cancelConnectionAttemptFromManager(): void {
    this.cancelConnectionAttempt();
  }

  emit(event: string, ...args: unknown[]): this {
    this.sendEvent(event, args);
    return this;
  }
  send(...args: unknown[]): this {
    return this.emit('message', ...args);
  }

  /** Send one event and expose timeout cancellation to `emitWithAck` only. */
  private sendEvent(event: string, args: unknown[]): ((reason: Error) => void) | undefined {
    assertNotReservedEvent(event);
    const flags = this.consumeFlags();
    const timed = withAckTimeout(args, flags.timeout);
    if (flags.volatile && !this.connected) return timed.cancel;
    // Before the connection completes, emits are buffered rather than lost, and
    // outgoing observation and encoding both wait for `completeConnection` (0026).
    if (!this.connected) {
      this.sendBuffer.push([event, timed.args]);
      return timed.cancel;
    }
    this.emitOutgoing(event, args);
    send(this.serverSocket, event, timed.args);
    return timed.cancel;
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    // Like the free `emitWithAck`, but the rejecter is registered so `disconnect`
    // can settle a still-pending ack, matching socket.io-client.
    return new Promise((resolve, reject) => {
      // Socket.IO's emitWithAck calls emit inside its Promise executor. A reserved name
      // therefore rejects the Promise rather than escaping as a synchronous throw.
      assertNotReservedEvent(event);
      const withError = this.flags.timeout !== undefined;
      const cancellation: {
        timeout?: (reason: Error) => void;
        reason?: Error;
        sending: boolean;
      } = { sending: true };
      const settleCancellation = (reason: Error) => {
        if (cancellation.timeout) cancellation.timeout(reason);
        else reject(reason);
      };
      const cancel = (reason: Error) => {
        // An outgoing observer may disconnect synchronously inside `sendEvent`, before it
        // returns the timeout cancellation. Keep that reason until the handle is published.
        if (cancellation.sending) cancellation.reason = reason;
        else settleCancellation(reason);
      };
      this.pendingAcks.add(cancel);
      const answer = (first: unknown, second: unknown) => {
        this.pendingAcks.delete(cancel);
        if (withError) {
          if (first) reject(first);
          else resolve(second);
        } else {
          resolve(first);
        }
      };
      cancellation.timeout = this.sendEvent(event, [...args, answer]);
      cancellation.sending = false;
      if (cancellation.reason) settleCancellation(cancellation.reason);
    });
  }

  /** Arm a timeout flag on this same client for consumption by its next emit. */
  timeout(ms: number): ClientSocket {
    this.flags.timeout = ms;
    return this;
  }

  /** Compression affects transport packet options upstream; the fluent logic surface remains. */
  compress(_compress: boolean): this {
    return this;
  }

  /**
   * The volatile emitter (0016). Unlike a normal emit, a volatile one is not buffered while
   * disconnected: sent before the connection completes it is dropped, and once connected it is
   * an ordinary emit. `this.connected` / `this.serverSocket` are read at emit time, not now.
   */
  get volatile(): this {
    this.flags.volatile = true;
    return this;
  }

  /** Snapshot and clear modifiers atomically, giving them a one-operation lifetime. */
  private consumeFlags(): SocketFlags {
    const flags = this.flags;
    this.flags = {};
    return flags;
  }

  connect(): this {
    // Already-connected `connect()` is a no-op in socket.io. Otherwise re-pair on
    // our namespace: a brand-new server socket and id, none of the old rooms, and the
    // same handshake source, so the reattached socket carries the original auth/query.
    if (this.connected) return this;
    const namespace = this.nsp ?? this.resolveNamespace?.();
    if (!namespace) {
      if (this.dynamicAdmission) this.dynamicAdmission(this);
      else this.failInvalidNamespace();
      return this;
    }
    this.nsp = namespace;
    namespace.pair(this, this.handshakeSource);
    return this;
  }

  open(): this {
    return this.connect();
  }

  disconnect(): this {
    if (!this.connected) {
      this.cancelConnectionAttempt();
      return this;
    }
    // Client-initiated: this side reports `io client disconnect`, then the server
    // side tears down and reports `client namespace disconnect`.
    this.markDisconnected('io client disconnect');
    this.serverSocket.handleDisconnect();
    return this;
  }

  close(): this {
    return this.disconnect();
  }

  /**
   * Flip to disconnected, settle any pending ack, and fire the client-side
   * `disconnect` with `reason`. Shared by a client-initiated disconnect and a
   * server-initiated one (`ServerSocket.disconnect`); only the reason differs.
   * socket.io-client settles a pending emitWithAck on disconnect instead of
   * leaving it hanging, which is why the rejecters are drained here.
   * Callers first verify this client is connected.
   */
  markDisconnected(reason: string): void {
    this.connected = false;
    this.id = undefined;
    this.io.disconnected(this);
    const rejecters = [...this.pendingAcks];
    this.pendingAcks.clear();
    for (const reject of rejecters) reject(new Error('socket has been disconnected'));
    this.dispatch('disconnect', [reason]);
  }

  /** Called by the Manager while applying connection-wide server teardown. */
  disconnectFromServer(): void {
    if (this.connected) this.serverSocket.disconnectNamespaceFromServer();
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
  private flags: SocketFlags = {};

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
  emit(event: string, ..._args: unknown[]): this {
    assertNotReservedEvent(event);
    this.flags = {};
    /* inert: never connected */
    return this;
  }
  send(...args: unknown[]): this {
    return this.emit('message', ...args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    this.flags = {};
    // No server will ever answer, so this stays pending, matching a client whose
    // connection never completes rather than inventing a rejection shape.
    return emitWithAck(undefined, event, args, Function.prototype as () => void);
  }
  timeout(ms: number): this {
    this.flags.timeout = ms;
    return this;
  }
  compress(_compress: boolean): this {
    return this;
  }
  get volatile(): this {
    this.flags.volatile = true;
    return this;
  }
  connect(): this {
    /* inert: the failure is terminal, no retry (0005) */
    return this;
  }
  open(): this {
    return this.connect();
  }
  disconnect(): this {
    /* inert: never connected */
    return this;
  }
  close(): this {
    return this.disconnect();
  }
}

/**
 * A timeout races the next trailing acknowledgement against a real timer and retains
 * the socket's ordinary send path, so buffering, deferral, and payload handling stay intact.
 * The pending flag itself is consumed before this helper decorates the acknowledgement.
 *
 * The race settles exactly once. When the ack answers first, the timer is cleared and
 * the callback gets `(null, response)`, error-first with the collapsed first value. When
 * the timer fires first, the callback gets a lone `Error('operation has timed out')` and
 * `settled` then drops the late ack, so the callback never fires a second time. All three
 * shapes (the null-first success, the single-argument timeout error, the dropped late ack)
 * are pinned against real socket.io.
 */
function withAckTimeout(
  args: unknown[],
  ms: number | undefined,
): { args: unknown[]; cancel?: (reason: Error) => void } {
  const last = args.at(-1);
  if (ms === undefined || typeof last !== 'function') return { args };

  const callback = last as (...received: unknown[]) => void;
  let settled = false;
  const timer = setTimeout(() => {
    settled = true;
    callback(new Error('operation has timed out'));
  }, ms);
  return {
    args: [
      ...args.slice(0, -1),
      (...answer: unknown[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(null, answer[0]);
      },
    ],
    cancel: (reason) => {
      settled = true;
      clearTimeout(timer);
      callback(reason);
    },
  };
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
  sendEncoded(target, event, encodePayload(data), ack);
}

/** Deliver one captured payload, decoding a fresh graph for this receiver. */
function sendEncoded(
  target: Emitter,
  event: string,
  payload: EncodedPayload,
  ack?: (...answer: unknown[]) => void,
): void {
  let acked = false;
  const data = decodePayload(payload);
  const finalArgs = ack
    ? [
        ...data,
        (...answer: unknown[]) => {
          if (acked) return;
          // Ack responses cross the same boundary when the receiver invokes the
          // callback, not when the request was sent (0026).
          const response = encodePayload(answer);
          acked = true;
          defer(() => ack(...decodePayload(response)));
        },
      ]
    : data;
  target.scheduleReceive(() => target.dispatch(event, finalArgs));
}

/**
 * Route one delivery to `sid` through the adapter's optional scheduling hook (#78), or the
 * default next-tick when it has none. Keeping the choice here means a socket with no
 * delay behaves exactly as before, so the conformance suite is untouched.
 */
function scheduleDelivery(adapter: SmocketAdapter, sid: string, deliver: () => void): void {
  if (adapter.scheduleDelivery) adapter.scheduleDelivery(sid, deliver);
  else defer(deliver);
}

/**
 * `emitWithAck` sugar over `send`'s trailing-callback ack: attach a callback
 * that resolves the promise with the peer's answer. The single-value resolve
 * shape is what the conformance suite pins against real socket.io.
 */
function emitWithAck(
  target: Emitter | undefined,
  event: string,
  args: unknown[],
  beforeSend: () => void,
): Promise<unknown> {
  return new Promise((resolve) => {
    // The guard lives inside the executor to preserve Socket.IO's rejected-Promise
    // shape for emitWithAck, while ordinary emit throws synchronously.
    assertNotReservedEvent(event);
    if (!target) return;
    beforeSend();
    send(target, event, [...args, (...answer: unknown[]) => resolve(answer[0])]);
  });
}

// Store listeners in arrays, not Sets, so a callback registered twice is kept
// twice and fired once per registration, the way real socket.io's emitters do
// (#125). A Set would de-duplicate, calling a doubly-registered callback once.
function addListener(
  map: Map<OrdinaryEventName, Listener[]>,
  event: OrdinaryEventName,
  listener: Listener,
): void {
  const list = map.get(event) ?? [];
  list.push(listener);
  map.set(event, list);
}

/** Remove the first occurrence of `listener` from `list` in place, if present. */
function removeFirst<Entry>(list: Entry[] | undefined, listener: Entry): void {
  if (!list) return;
  const i = list.indexOf(listener);
  if (i !== -1) list.splice(i, 1);
}

/**
 * Remove one ordinary named registration and delete an emptied registry key.
 * Catch-all backing arrays do not use this helper because their detach rules differ.
 */
function removeOrdinaryListener(
  map: Map<OrdinaryEventName, Listener[]>,
  event: OrdinaryEventName,
  listener: Listener,
  fromEnd = false,
): void {
  const list = map.get(event);
  if (!list) return;
  if (fromEnd) {
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      if (entry !== undefined && isListener(entry, listener)) {
        list.splice(i, 1);
        break;
      }
    }
  } else {
    const index = list.findIndex((entry) => isListener(entry, listener));
    if (index !== -1) list.splice(index, 1);
  }
  if (list.length === 0) map.delete(event);
}

/** True for a direct listener or either emitter's side-specific `once` wrapper. */
function isListener(entry: Listener, listener: Listener): boolean {
  const wrapper = entry as { fn?: Listener; listener?: Listener };
  return entry === listener || wrapper.fn === listener || wrapper.listener === listener;
}
