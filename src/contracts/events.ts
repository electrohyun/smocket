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
export type AnyListener = (...args: any[]) => void;

/** A mutable Socket.IO packet presented to server Socket middleware. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Event = [string, ...any[]];

/** Per-packet server Socket middleware. */
export type SocketMiddleware = (event: Event, next: (error?: Error) => void) => void;

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
export type FirstClientAckValue<Callback> = Callback extends (arg: infer Value) => infer Result
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
export type ClientLast<Values extends any[]> = Values extends [...infer Head, infer Tail]
  ? Head extends unknown[]
    ? Tail
    : never
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClientAllButLast<Values extends any[]> = Values extends [...infer Head, infer Tail]
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
