import type { Server, Socket as IoServerSocket } from 'socket.io';
import type { Socket as IoClientSocket } from 'socket.io-client';

/** Socket.IO's untyped default: every string event accepts any argument list. */
export interface DefaultEventsMap {
  // A function-valued `any` index is required for ordinary interface event maps to
  // satisfy the constraint without declaring their own index signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [event: string]: (...args: any[]) => void;
}

export interface EventsMap {
  // Socket.IO uses the same `any` constraint. `unknown` would reject a map such as
  // `{ chat: (message: string) => void }` because it has no string index signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [event: string]: any;
}

/** Socket.IO's permissive public shape for catch-all listener lookups. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyListener = (...args: any[]) => void;

/** Socket.IO's default when an application does not declare a socket data shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DefaultSocketData = any;

export type EventName<Map extends EventsMap> = keyof Map & string;
export type EventParams<Map extends EventsMap, Event extends EventName<Map>> = Parameters<
  Map[Event]
>;
export type MessageEventParams<Map extends EventsMap> = EventParams<
  Map,
  Extract<'message', EventName<Map>>
>;
export type Last<Values extends readonly unknown[]> = Values extends readonly [infer Only]
  ? Only
  : Values extends readonly [unknown, ...infer Tail]
    ? Last<Tail>
    : Values extends ReadonlyArray<infer Value>
      ? Value
      : never;
// This mirrors Socket.IO's tuple helper exactly. Its `any[]` fallback is what
// keeps the untyped default accepting arbitrary arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AllButLast<Values extends any[]> = Values extends [...infer Head, unknown]
  ? Head
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any[];
type FirstNonErrorTuple<Values extends unknown[]> = Values[0] extends Error ? Values[1] : Values[0];
export type FirstAckValue<Callback> = Callback extends (
  ...args: infer Values
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => any
  ? FirstNonErrorTuple<Values>
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;
// Socket.IO's helper infers the return type even though it only returns the first argument.
type FirstClientAckValue<Callback> = Callback extends (arg: infer Value) => infer Result
  ? [Result] extends [unknown]
    ? Value
    : never
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;
type IsAny<Value> = 0 extends 1 & Value ? true : false;
type IfAny<Value, IfTrue, IfFalse> = IsAny<Value> extends true ? IfTrue : IfFalse;
// Socket.IO client uses tuple helpers whose empty-tuple fallbacks differ from
// the server helpers above. Keeping them separate preserves its public surface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClientLast<Values extends any[]> = Values extends [...infer Head, infer Tail]
  ? Head extends unknown[]
    ? Tail
    : never
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClientAllButLast<Values extends any[]> = Values extends [...infer Head, infer Tail]
  ? [Tail] extends [unknown]
    ? Head
    : never
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any[];
export type EventNameWithAck<
  Map extends EventsMap,
  Event extends EventName<Map> = EventName<Map>,
> = IfAny<
  Last<EventParams<Map, Event>> | Map[Event],
  Event,
  Event extends Event
    ? Last<EventParams<Map, Event>> extends (...args: never[]) => unknown
      ? // Socket.IO uses `void` here so both `undefined` and an explicit `void` response are excluded.
        // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
        FirstAckValue<Last<EventParams<Map, Event>>> extends void
        ? never
        : Event
      : never
    : never
>;
type LooseParameters<Value> = Value extends (...args: infer Params) => unknown ? Params : never;
/** Broadcast Promise acknowledgements require an error-first collector callback upstream. */
export type EventNameWithError<
  Map extends EventsMap,
  Event extends EventNameWithAck<Map> = EventNameWithAck<Map>,
> = IfAny<
  Last<EventParams<Map, Event>> | Map[Event],
  Event,
  Event extends Event
    ? LooseParameters<Last<EventParams<Map, Event>>>[0] extends Error
      ? Event
      : never
    : never
>;
export type EventNameWithoutAck<
  Map extends EventsMap,
  Event extends EventName<Map> = EventName<Map>,
> = IfAny<
  Last<EventParams<Map, Event>> | Map[Event],
  Event,
  Event extends Event
    ? EventParams<Map, Event> extends never[]
      ? Event
      : Last<EventParams<Map, Event>> extends (...args: never[]) => unknown
        ? never
        : Event
    : never
>;

type PrependTimeoutError<Values extends unknown[]> = {
  [Key in keyof Values]: Values[Key] extends (...args: infer Params) => infer Result
    ? Params[0] extends Error
      ? Values[Key]
      : (error: Error, ...args: Params) => Result
    : Values[Key];
};
type MultiplyArray<Values extends unknown[]> = { [Key in keyof Values]: Values[Key][] };
type FirstTupleValue<Values extends unknown[]> = Values extends [infer First, ...unknown[]]
  ? [First]
  : [];
type ExpectMultipleResponses<Values extends unknown[]> = {
  [Key in keyof Values]: Values[Key] extends (...args: infer Params) => infer Result
    ? Params extends [Error]
      ? (error: Error) => Result
      : Params extends [Error, ...infer Rest]
        ? (error: Error, ...args: FirstTupleValue<MultiplyArray<Rest>>) => Result
        : Params extends []
          ? () => Result
          : (...args: FirstTupleValue<MultiplyArray<Params>>) => Result
    : Values[Key];
};
export type DecorateAcknowledgements<Map extends EventsMap> = {
  [Event in keyof Map]: Map[Event] extends (...args: infer Params) => infer Result
    ? (...args: PrependTimeoutError<Params>) => Result
    : Map[Event];
};
export type DecorateAcknowledgementsWithMultipleResponses<Map extends EventsMap> = {
  [Event in keyof Map]: Map[Event] extends (...args: infer Params) => infer Result
    ? (...args: ExpectMultipleResponses<Params>) => Result
    : Map[Event];
};

export type ReservedOrUserEventName<
  ReservedEvents extends EventsMap,
  UserEvents extends EventsMap,
> = EventName<ReservedEvents> | EventName<UserEvents>;
export type ReservedOrUserListener<
  ReservedEvents extends EventsMap,
  UserEvents extends EventsMap,
  Event extends ReservedOrUserEventName<ReservedEvents, UserEvents>,
> =
  Event extends EventName<ReservedEvents>
    ? ReservedEvents[Event]
    : Event extends EventName<UserEvents>
      ? UserEvents[Event]
      : never;

export type SupportedServerListenerEvents<Map extends EventsMap> = string extends keyof Map
  ? DefaultEventsMap
  : Record<never, never>;

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
 * Generic event maps keep names, payloads, acknowledgements and socket data through
 * this shared surface. Their defaults retain the original accept-any-event shape.
 * Socket.IO's private listener fallback is the one structural exception, explained
 * beside the parity projections at the bottom.
 */

/**
 * Result of `io.to()` / `socket.broadcast` / `socket.to()` and friends. Every way of
 * narrowing a broadcast lives on the operator itself, not only on the entry points, so
 * `to` / `in` / `except` / `timeout` compose in any order (#137).
 */
export interface BroadcastContract<
  EmitEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean;
  /**
   * Collect one acknowledgement from every selected recipient. Without an explicit
   * timeout, Socket.IO races the responses against `setTimeout(undefined)`; an empty
   * selection resolves with `[]`, while recipient acknowledgements may win or lose that
   * zero-delay race.
   */
  emitWithAck<Event extends EventNameWithError<EmitEvents>>(
    event: Event,
    ...args: AllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstAckValue<Last<EventParams<EmitEvents, Event>>>>;
  to(room: string | string[]): BroadcastContract<EmitEvents, SocketData>;
  /** An alias of `to`, as at the entry points. */
  in(room: string | string[]): BroadcastContract<EmitEvents, SocketData>;
  /** Exclude a room from this broadcast, on top of any exclusion it already carries. */
  except(room: string | string[]): BroadcastContract<EmitEvents, SocketData>;
  /** Add an ack timeout to this broadcast; see {@link TimeoutBroadcastContract}. */
  timeout(ms: number): TimeoutBroadcastContract<DecorateAcknowledgements<EmitEvents>, SocketData>;
  /** Return a new operator carrying the transport compression preference. */
  compress(compress: boolean): BroadcastContract<EmitEvents, SocketData>;
  /** Mark the narrowed broadcast volatile while preserving its rooms and exclusions. */
  readonly volatile: BroadcastContract<EmitEvents, SocketData>;
}

/** The acknowledgement-decorated emitter slice retained for backwards-compatible imports. */
export interface TimeoutEmitterContract<EmitEvents extends EventsMap = DefaultEventsMap> {
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): this;
  emitWithAck<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: ClientAllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstClientAckValue<ClientLast<EventParams<EmitEvents, Event>>>>;
}

/**
 * A broadcast carrying an ack timeout, from `io.timeout(ms)` / `socket.timeout(ms).to(...)`
 * / `socket.broadcast.timeout(ms)` and the like. Its `emit`'s trailing callback is invoked
 * once with `(null, responses)` when every recipient acks in time, or `(Error('operation
 * has timed out'), responses)` when the timer wins, where `responses` holds the acks that
 * arrived, in arrival order. A broadcast to no recipient resolves at once as `(null, [])`.
 * A late ack cannot settle the callback or Promise twice, but it may append to an already
 * exposed partial-response array. The narrowing methods chain and keep the timeout, so
 * `io.timeout(ms).to(a).to(b)` targets the union and
 * `io.timeout(ms).to(a).except(b)` collects from the survivors only (#137). Reading
 * `volatile` before or after those narrowings keeps both the timeout and event map.
 */
export interface TimeoutBroadcastContract<
  EmitEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean;
  /** Rejects on expiry with partial responses on the Error's own `responses` property. */
  emitWithAck<Event extends EventNameWithError<EmitEvents>>(
    event: Event,
    ...args: AllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstAckValue<Last<EventParams<EmitEvents, Event>>>>;
  to(room: string | string[]): TimeoutBroadcastContract<EmitEvents, SocketData>;
  /** An alias of `to`, as at the entry points. */
  in(room: string | string[]): TimeoutBroadcastContract<EmitEvents, SocketData>;
  /** Exclude a room from this broadcast, on top of any exclusion it already carries. */
  except(room: string | string[]): TimeoutBroadcastContract<EmitEvents, SocketData>;
  /** Preserve the timeout decoration while setting the transport compression preference. */
  compress(compress: boolean): TimeoutBroadcastContract<EmitEvents, SocketData>;
  /** Mark the narrowed broadcast volatile while preserving its timeout and event map. */
  readonly volatile: TimeoutBroadcastContract<EmitEvents, SocketData>;
}

/**
 * The acknowledgement-decorated server emitter and broadcast slice retained for
 * backwards-compatible imports. `ServerSocketContract.timeout()` itself returns the full
 * socket surface, matching Socket.IO.
 */
export interface SocketTimeoutContract<
  EmitEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean;
  emitWithAck<Event extends EventNameWithAck<EmitEvents>>(
    event: Event,
    ...args: AllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstAckValue<Last<EventParams<EmitEvents, Event>>>>;
  broadcast: TimeoutBroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  >;
  to(
    room: string | string[],
  ): TimeoutBroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  >;
  except(
    room: string | string[],
  ): TimeoutBroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  >;
}

/**
 * The volatile server emitter and broadcast slice retained for backwards-compatible
 * imports. `ServerSocketContract.volatile` itself returns the full socket surface.
 */
export interface VolatileServerSocket<
  EmitEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean;
  emitWithAck<Event extends EventNameWithAck<EmitEvents>>(
    event: Event,
    ...args: AllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstAckValue<Last<EventParams<EmitEvents, Event>>>>;
  broadcast: BroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  >;
  to(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  except(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
}

/** The client volatile emitter slice retained for backwards-compatible imports. */
export interface VolatileClientSocket<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
> {
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): this;
  emitWithAck<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: ClientAllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstClientAckValue<ClientLast<EventParams<EmitEvents, Event>>>>;
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

type ServerDisconnectReason =
  | 'transport error'
  | 'transport close'
  | 'forced close'
  | 'ping timeout'
  | 'parse error'
  | 'server shutting down'
  | 'forced server close'
  | 'client namespace disconnect'
  | 'server namespace disconnect';

type ClientDisconnectReason =
  | 'io server disconnect'
  | 'io client disconnect'
  | 'ping timeout'
  | 'transport close'
  | 'transport error'
  | 'parse error';

type ClientDisconnectDescription = Error | { description: string; context?: unknown };

interface ServerSocketReservedEvents {
  // Socket.IO deliberately leaves this transport-specific detail untyped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  disconnect: (reason: ServerDisconnectReason, description?: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  disconnecting: (reason: ServerDisconnectReason, description?: any) => void;
  error: (error: Error) => void;
}

interface ClientSocketReservedEvents {
  connect: () => void;
  connect_error: (error: Error) => void;
  disconnect: (reason: ClientDisconnectReason, description?: ClientDisconnectDescription) => void;
}

export interface NamespaceReservedEvents<
  ListenEvents extends EventsMap,
  EmitEvents extends EventsMap,
  ServerSideEvents extends EventsMap,
  SocketData,
> {
  connect: (
    socket: ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ) => void;
  connection: (
    socket: ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ) => void;
}

export interface ServerReservedEvents<
  ListenEvents extends EventsMap,
  EmitEvents extends EventsMap,
  ServerSideEvents extends EventsMap,
  SocketData,
> extends NamespaceReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
  new_namespace: (
    namespace: NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ) => void;
}

/** Selects a dynamic namespace from its normalized name and client auth payload. */
export type ParentNspNameMatchFn = (
  name: string,
  auth: Record<string, unknown>,
  next: (error: Error | null, allowed: boolean) => void,
) => void;

/**
 * A connection middleware, registered through `io.use()`. It runs after the handshake
 * is built and before the socket is considered connected: `next()` admits the
 * connection and passes control to the next middleware (or completes it, if last),
 * while `next(err)` rejects it, and the client observes a `connect_error` carrying
 * `err`. A rejected socket never joins its id-room, never enters the roster, and never
 * reaches a `connection` handler. Registration order is execution order, and the first
 * middleware to reject short-circuits the rest.
 * Any room membership created while middleware runs is removed when the attempt is
 * rejected or cancelled before admission, without firing a disconnect lifecycle for a
 * socket that never connected.
 */
export type ConnectionMiddleware<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = (
  socket: ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  next: (err?: MiddlewareError) => void,
) => void;

/** A namespace, as returned by `io.of()` and read via `socket.nsp`. */
export interface NamespaceContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  name: string;
  adapter: AdapterContract;
  /**
   * Per-namespace entry point: `io.of(name).on('connection', cb)` fires `cb` only
   * for connections on that namespace. `io.on('connection')` is the `/` case of
   * this, so both go through the same surface.
   */
  on<
    Event extends ReservedOrUserEventName<
      NamespaceReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      SupportedServerListenerEvents<ServerSideEvents>
    >,
  >(
    event: Event,
    listener: ReservedOrUserListener<
      NamespaceReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      SupportedServerListenerEvents<ServerSideEvents>,
      Event
    >,
  ): this;
  /**
   * Register a connection middleware on this namespace; see {@link ConnectionMiddleware}.
   * Called once per incoming connection here, in registration order.
   */
  use(
    middleware: ConnectionMiddleware<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ): this;
  emit<Event extends EventNameWithoutAck<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean;
  /** Emit the mapped `message` event and return this namespace. */
  send(...args: MessageEventParams<EmitEvents>): this;
  /** Alias of {@link send}. */
  write(...args: MessageEventParams<EmitEvents>): this;
  to(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  /** An alias of `to`, as on the server and broadcast operator. */
  in(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  except(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  /** A timed broadcast to this namespace; see {@link TimeoutBroadcastContract}. */
  timeout(
    ms: number,
  ): TimeoutBroadcastContract<
    DecorateAcknowledgements<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>>,
    SocketData
  >;
  /** Return a new broadcast operator carrying the transport compression preference. */
  compress(
    compress: boolean,
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  /** Namespace-wide volatile broadcast: `io.of(ns).volatile.emit(...)`; see {@link VolatileServerSocket}. */
  volatile: BroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  >;
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
export type AdapterFactory<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = (
  nsp: NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
) => SmocketAdapter;

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
export interface ServerContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
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
  ): void;
  /**
   * `io.use` is the default namespace's `use`: it registers a connection middleware for
   * connections on `/`, exactly as `io.of('/').use` would. See {@link ConnectionMiddleware}.
   */
  use(
    middleware: ConnectionMiddleware<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ): this;
  emit<Event extends EventNameWithoutAck<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean;
  /** Emit the mapped `message` event on `/` and return this server. */
  send(...args: MessageEventParams<EmitEvents>): this;
  /** Alias of {@link send}. */
  write(...args: MessageEventParams<EmitEvents>): this;
  to(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  in(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  except(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  /** A timed broadcast to `/`: `io.timeout(ms).to(room).emit(...)`; see {@link TimeoutBroadcastContract}. */
  timeout(
    ms: number,
  ): TimeoutBroadcastContract<
    DecorateAcknowledgements<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>>,
    SocketData
  >;
  /** Return a new root broadcast operator carrying the transport compression preference. */
  compress(
    compress: boolean,
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  /** Server-wide volatile broadcast: `io.volatile.to(room).emit(...)`; see {@link VolatileServerSocket}. */
  volatile: BroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  >;
  /** Register or read a static namespace, or register a dynamic parent. */
  of(
    matcher: string | RegExp | ParentNspNameMatchFn,
    listener?: (
      socket: ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    ) => void,
  ): NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
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
export interface SmocketServer<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> extends ServerContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
  /**
   * Replace the routing adapter for every namespace on this server. See
   * [adapter-registration.md](../docs/adapter-registration.md) and {@link AdapterFactory}.
   */
  adapter(factory: AdapterFactory<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): void;
  /**
   * Resolve with the server-side socket of the next client to connect on `namespace`,
   * which defaults to `/`. Pairs a connect with its server side when the caller drives
   * the connection itself rather than through a helper.
   */
  nextConnection(
    namespace?: string,
  ): Promise<ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>>;
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
export interface ServerSocketContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  id: string;
  /** Server-only view of room membership; a live Set emptied in place on teardown. */
  rooms: Set<string>;
  nsp: NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  broadcast: BroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  >;
  /** The connection handshake; see {@link Handshake}. */
  handshake: Handshake;
  /**
   * A per-socket store, an empty object at creation (#108). Connection middleware writes
   * to it (`socket.data.userId = ...`) and an event handler reads it back, the place to
   * carry what middleware resolved from the handshake. Server-only, never sent to the
   * client, and tied to the socket: a reconnection is a fresh socket with a fresh `data`.
   */
  data: SocketData;
  on<Event extends ReservedOrUserEventName<ServerSocketReservedEvents, ListenEvents>>(
    event: Event,
    listener: ReservedOrUserListener<ServerSocketReservedEvents, ListenEvents, Event>,
  ): this;
  once<Event extends ReservedOrUserEventName<ServerSocketReservedEvents, ListenEvents>>(
    event: Event,
    listener: ReservedOrUserListener<ServerSocketReservedEvents, ListenEvents, Event>,
  ): this;
  /** Remove one registration. The server is Node's emitter, so a listener is required (0017). */
  off(event: string, listener: (...args: unknown[]) => void): this;
  /** Remove every listener for `event`, or all of them when called with no argument. */
  removeAllListeners(event?: string): this;
  /** Catch-all for incoming events; the listener receives the event name then its args. */
  onAny(listener: AnyListener): this;
  /** Add an incoming catch-all ahead of every existing catch-all listener. */
  prependAny(listener: AnyListener): this;
  /** The live incoming catch-all backing array. */
  listenersAny(): AnyListener[];
  /** Remove one catch-all listener, or all of them when called with no argument. */
  offAny(listener?: AnyListener): this;
  /** Catch-all for outgoing events this socket sends; receives the event name then its args. */
  onAnyOutgoing(listener: AnyListener): this;
  /** Add an outgoing catch-all ahead of every existing catch-all listener. */
  prependAnyOutgoing(listener: AnyListener): this;
  /** The live outgoing catch-all backing array. */
  listenersAnyOutgoing(): AnyListener[];
  /** Remove one outgoing catch-all, or all of them when called with no argument. */
  offAnyOutgoing(listener?: AnyListener): this;
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean;
  /** Emit the mapped `message` event and return this socket. */
  send(...args: MessageEventParams<EmitEvents>): this;
  /** Alias of {@link send}. */
  write(...args: MessageEventParams<EmitEvents>): this;
  emitWithAck<Event extends EventNameWithAck<EmitEvents>>(
    event: Event,
    ...args: AllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstAckValue<Last<EventParams<EmitEvents, Event>>>>;
  /** Arm a one-shot acknowledgement timeout and return this same socket. */
  timeout(
    ms: number,
  ): ServerSocketContract<
    ListenEvents,
    DecorateAcknowledgements<EmitEvents>,
    ServerSideEvents,
    SocketData
  >;
  /** The volatile emitter (0016): a plain emit once connected, dropped in the pre-connect window. */
  readonly volatile: this;
  /** Set the transport compression preference for the next emission and return this socket. */
  compress(compress: boolean): this;
  join(room: string | string[]): Promise<void> | void;
  leave(room: string): Promise<void> | void;
  to(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  /** An exact alias of {@link to}. */
  in(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  except(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData>;
  /**
   * Server-initiated disconnect. `false` closes this namespace socket; `true`
   * closes every namespace socket sharing its logical Manager (0028). Fires
   * `disconnect` on both sides with real socket.io's reason for this path.
   */
  disconnect(close?: boolean): this;
}

/** A client-side socket, as `client`. */
export interface ClientSocketContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
> {
  connected: boolean;
  /** Undefined until connected, matching socket.io-client. */
  id: string | undefined;
  /** The shared Manager; compared only by identity across namespaces. */
  io: unknown;
  on<Event extends ReservedOrUserEventName<ClientSocketReservedEvents, ListenEvents>>(
    event: Event,
    listener: ReservedOrUserListener<ClientSocketReservedEvents, ListenEvents, Event>,
  ): this;
  once<Event extends ReservedOrUserEventName<ClientSocketReservedEvents, ListenEvents>>(
    event: Event,
    listener: ReservedOrUserListener<ClientSocketReservedEvents, ListenEvents, Event>,
  ): this;
  /**
   * The client is component-emitter's: `off()` clears every listener, `off(event)`
   * clears that event, and `off(event, listener)` removes one. No form throws (0017).
   */
  off(event?: string, listener?: (...args: unknown[]) => void): this;
  /** Remove every listener for `event`, or all of them when called with no argument. */
  removeAllListeners(event?: string): this;
  /** Catch-all for incoming events; the listener receives the event name then its args. */
  onAny(listener: AnyListener): this;
  /** Add an incoming catch-all ahead of every existing catch-all listener. */
  prependAny(listener: AnyListener): this;
  /** The live incoming catch-all backing array. */
  listenersAny(): AnyListener[];
  /** Remove one catch-all listener, or all of them when called with no argument. */
  offAny(listener?: AnyListener): this;
  /** Catch-all for outgoing events this socket sends; receives the event name then its args. */
  onAnyOutgoing(listener: AnyListener): this;
  /** Add an outgoing catch-all ahead of every existing catch-all listener. */
  prependAnyOutgoing(listener: AnyListener): this;
  /** The live outgoing catch-all backing array. */
  listenersAnyOutgoing(): AnyListener[];
  /** Remove one outgoing catch-all, or all of them when called with no argument. */
  offAnyOutgoing(listener?: AnyListener): this;
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): this;
  /** Emit `message` with socket.io-client's permissive argument surface. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(...args: any[]): this;
  emitWithAck<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: ClientAllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstClientAckValue<ClientLast<EventParams<EmitEvents, Event>>>>;
  /** Arm a one-shot acknowledgement timeout and return this same socket. */
  timeout(ms: number): ClientSocketContract<ListenEvents, DecorateAcknowledgements<EmitEvents>>;
  /** The volatile emitter (0016): a plain emit once connected, dropped in the pre-connect window. */
  readonly volatile: this;
  /** Set the transport compression preference for the next emission and return this socket. */
  compress(compress: boolean): this;
  connect(): this;
  /** Alias of {@link connect}. */
  open(): this;
  disconnect(): this;
  /** Alias of {@link disconnect}. */
  close(): this;
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
  /** Open this namespace on an independent Manager instead of the origin's cached one. */
  forceNew?: boolean;
  /** `false` opts this namespace out of sharing the origin's cached Manager. */
  multiplex?: boolean;
}

export interface ConnectedClient<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  client: ClientSocketContract<EmitEvents, ListenEvents>;
  serverSocket: ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
}

/**
 * The shape both `setupRealServer` and `setupMockServer` return. Selecting the
 * target is a one-import swap in the test files; nothing else changes.
 */
export interface ServerContext<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  io: ServerContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  /** Connect one more client and return it paired with its server-side socket. */
  connectClient: (
    options?: ConnectOptions,
  ) => Promise<ConnectedClient<ListenEvents, EmitEvents, ServerSideEvents, SocketData>>;
  /**
   * Open a connection and return the client immediately, without waiting for it to
   * connect. Needed for a connection expected to fail (a middleware rejection): its
   * `connect` never fires, so `connectClient` would hang, whereas a test drives this
   * and awaits the client's `connect_error` instead.
   */
  openClient: (options?: ConnectOptions) => ClientSocketContract<EmitEvents, ListenEvents>;
  /**
   * Open a client on a namespace without observing `nextConnection` first. The real
   * fixture keeps this separate because `ioServer.of(namespace)` would register the
   * namespace and invalidate an unregistered-admission test before the client starts.
   */
  openUnregisteredClient: (namespace: string) => ClientSocketContract<EmitEvents, ListenEvents>;
  /**
   * Connect `count` clients and return them paired with their server-side
   * sockets, in connection order. Sugar over `connectClient` for the recurring
   * multi-client setup; connections are made one at a time, since the harness
   * pairs each connect with the next `connection`, so connecting concurrently
   * would mismatch the pairs.
   */
  connectClients: (
    count: number,
    options?: ConnectOptions,
  ) => Promise<ConnectedClient<ListenEvents, EmitEvents, ServerSideEvents, SocketData>[]>;
  /**
   * Resolve with the server-side socket of the next client to connect on
   * `namespace`. Needed when the connection is not started by `connectClient`,
   * as with a reconnect of a client already known to the test.
   */
  nextConnection: (
    namespace?: string,
  ) => Promise<ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>>;
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

// Socket.IO's listener declarations use an internal conditional fallback that
// TypeScript cannot compare structurally with an equivalent public contract once
// event maps are still generic. Keep listener inference covered by the consumer
// typecheck file, and keep the structural proof for every other member here.
type NamespaceParityContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = Omit<
  NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  'on' | 'send' | 'use' | 'write'
> & {
  send(
    ...args: MessageEventParams<EmitEvents>
  ): NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  write(
    ...args: MessageEventParams<EmitEvents>
  ): NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  use(
    middleware: (
      socket: ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      next: (error?: MiddlewareError) => void,
    ) => void,
  ): NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
};

type ServerParityContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = Omit<
  ServerContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  'of' | 'on' | 'send' | 'use' | 'write'
> & {
  send(
    ...args: MessageEventParams<EmitEvents>
  ): ServerParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  write(
    ...args: MessageEventParams<EmitEvents>
  ): ServerParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  of(
    matcher: string | RegExp | ParentNspNameMatchFn,
    listener?: (
      socket: ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    ) => void,
  ): NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  use(
    middleware: (
      socket: ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      next: (error?: MiddlewareError) => void,
    ) => void,
  ): ServerParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
};

type ServerSocketParityContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = Pick<
  ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  | 'broadcast'
  | 'data'
  | 'emit'
  | 'emitWithAck'
  | 'except'
  | 'handshake'
  | 'id'
  | 'in'
  | 'join'
  | 'leave'
  | 'rooms'
  | 'to'
> & {
  readonly volatile: ServerSocketParityContract<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >;
  timeout(
    ms: number,
  ): ServerSocketParityContract<
    ListenEvents,
    DecorateAcknowledgements<EmitEvents>,
    ServerSideEvents,
    SocketData
  >;
  disconnect(
    close?: boolean,
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  send(
    ...args: MessageEventParams<EmitEvents>
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  write(
    ...args: MessageEventParams<EmitEvents>
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  compress(
    compress: boolean,
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  nsp: NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
};

type ClientSocketParityContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
> = Pick<
  ClientSocketContract<ListenEvents, EmitEvents>,
  'connected' | 'emitWithAck' | 'id' | 'io'
> & {
  readonly volatile: ClientSocketParityContract<ListenEvents, EmitEvents>;
  timeout(
    ms: number,
  ): ClientSocketParityContract<ListenEvents, DecorateAcknowledgements<EmitEvents>>;
  connect(): ClientSocketParityContract<ListenEvents, EmitEvents>;
  open(): ClientSocketParityContract<ListenEvents, EmitEvents>;
  disconnect(): ClientSocketParityContract<ListenEvents, EmitEvents>;
  close(): ClientSocketParityContract<ListenEvents, EmitEvents>;
  compress(compress: boolean): ClientSocketParityContract<ListenEvents, EmitEvents>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(...args: any[]): ClientSocketParityContract<ListenEvents, EmitEvents>;
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): ClientSocketParityContract<ListenEvents, EmitEvents>;
};

// Socket.io reference types, derived by indexing so no generic arguments (and no
// `any`) are written by hand.
type IoNamespace = ReturnType<Server['of']>;
type IoBroadcast = ReturnType<Server['to']>;
type IoAdapter = IoNamespace['adapter'];

// Exported only so `noUnusedLocals` treats them as used (an unused local type
// alias is TS6196); they are compile-time guards, not meant to be imported.
export type AssertServerContract = Ensure<ServerParityContract, Server>;
export type AssertServerSocketContract = Ensure<ServerSocketParityContract, IoServerSocket>;
export type AssertClientSocketContract = Ensure<ClientSocketParityContract, IoClientSocket>;
export type AssertNamespaceContract = Ensure<NamespaceParityContract, IoNamespace>;
export type AssertBroadcastContract = Ensure<BroadcastContract, IoBroadcast>;
export type AssertAdapterContract = Ensure<AdapterContract, IoAdapter>;

interface AssertClientToServerEvents {
  request: (value: string, ack: (accepted: boolean) => void) => void;
}

interface AssertServerToClientEvents {
  notice: (value: string) => void;
  question: (value: string, ack: (answer: number) => void) => void;
}

interface AssertServerSideEvents {
  health: () => void;
}

interface AssertSocketData {
  userId: string;
}

type ConcreteIoServer = Server<
  AssertClientToServerEvents,
  AssertServerToClientEvents,
  AssertServerSideEvents,
  AssertSocketData
>;
type ConcreteIoNamespace = ReturnType<ConcreteIoServer['of']>;
type ConcreteIoBroadcast = ReturnType<ConcreteIoServer['to']>;

export type AssertConcreteServerContract = Ensure<
  ServerParityContract<
    AssertClientToServerEvents,
    AssertServerToClientEvents,
    AssertServerSideEvents,
    AssertSocketData
  >,
  ConcreteIoServer
>;
export type AssertConcreteServerSocketContract = Ensure<
  ServerSocketParityContract<
    AssertClientToServerEvents,
    AssertServerToClientEvents,
    AssertServerSideEvents,
    AssertSocketData
  >,
  IoServerSocket<
    AssertClientToServerEvents,
    AssertServerToClientEvents,
    AssertServerSideEvents,
    AssertSocketData
  >
>;
export type AssertConcreteClientSocketContract = Ensure<
  ClientSocketParityContract<AssertServerToClientEvents, AssertClientToServerEvents>,
  IoClientSocket<AssertServerToClientEvents, AssertClientToServerEvents>
>;
export type AssertConcreteNamespaceContract = Ensure<
  NamespaceParityContract<
    AssertClientToServerEvents,
    AssertServerToClientEvents,
    AssertServerSideEvents,
    AssertSocketData
  >,
  ConcreteIoNamespace
>;
export type AssertConcreteBroadcastContract = Ensure<
  BroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<AssertServerToClientEvents>,
    AssertSocketData
  >,
  ConcreteIoBroadcast
>;
