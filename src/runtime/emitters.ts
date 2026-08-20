import type { ClientSocketContract } from '../contract';
import { hostEmitsFinalRemoveListenerMetaEvent } from '../host-emitter';
import { defer, RESERVED_EVENTS } from './delivery';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Listener = (...args: any[]) => void;
export type OrdinaryEventName = string | symbol;
interface NodeListenerState {
  readonly warnedEvents: Set<OrdinaryEventName>;
  maxListeners: number;
}
type EmitNodeMeta = (
  event: 'newListener' | 'removeListener',
  observedEvent: OrdinaryEventName,
  listener: Listener,
) => boolean;
const HOST_EMITS_FINAL_REMOVE_LISTENER_META_EVENT = hostEmitsFinalRemoveListenerMetaEvent();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyListener = (...args: any[]) => void;

/** Browser-safe Node EventEmitter behavior shared by namespaces. */
export abstract class NodeEmitter {
  protected readonly eventListeners = new Map<OrdinaryEventName, Listener[]>();
  private readonly nodeListenerState = createNodeListenerState();

  abstract emit(event: string, ...args: unknown[]): boolean;

  private addNodeListener(
    event: OrdinaryEventName,
    listener: Listener,
    prepend = false,
    exposedListener = listener,
  ): void {
    addNodeListener(
      this,
      this.eventListeners,
      this.nodeListenerState,
      (metaEvent, observedEvent, exposed) => this.emit(metaEvent, observedEvent, exposed),
      event,
      listener,
      prepend,
      exposedListener,
    );
  }

  on(event: OrdinaryEventName, listener: Listener): this {
    this.addNodeListener(event, listener);
    return this;
  }

  addListener(event: OrdinaryEventName, listener: Listener): this {
    return this.on(event, listener);
  }

  once(event: OrdinaryEventName, listener: Listener): this {
    assertNodeListener(listener);
    const wrapper = ((...args: never[]) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    }) as Listener;
    (wrapper as { listener?: Listener }).listener = listener;
    this.addNodeListener(event, wrapper, false, listener);
    return this;
  }

  prependListener(event: OrdinaryEventName, listener: Listener): this {
    this.addNodeListener(event, listener, true);
    return this;
  }

  prependOnceListener(event: OrdinaryEventName, listener: Listener): this {
    assertNodeListener(listener);
    const wrapper = ((...args: never[]) => {
      this.removeListener(event, wrapper);
      listener.apply(this, args);
    }) as Listener;
    (wrapper as { listener?: Listener }).listener = listener;
    this.addNodeListener(event, wrapper, true, listener);
    return this;
  }

  removeListener(event: OrdinaryEventName, listener: Listener): this {
    removeNodeListener(
      this.eventListeners,
      (metaEvent, observedEvent, exposed) => this.emit(metaEvent, observedEvent, exposed),
      event,
      listener,
    );
    return this;
  }

  readonly off = this.removeListener;

  removeAllListeners(event?: OrdinaryEventName): this {
    removeAllNodeListeners(
      this.eventListeners,
      this.nodeListenerState,
      (name, listener) => this.removeListener(name, listener),
      event,
    );
    return this;
  }

  listeners(event: OrdinaryEventName): Listener[] {
    return nodeListeners(this.eventListeners, event);
  }

  rawListeners(event: OrdinaryEventName): Listener[] {
    return nodeRawListeners(this.eventListeners, event);
  }

  listenerCount(event: OrdinaryEventName, listener?: Listener): number {
    return nodeListenerCount(this.eventListeners, event, listener);
  }

  eventNames(): (string | symbol)[] {
    return nodeEventNames(this.eventListeners);
  }

  setMaxListeners(maxListeners: number): this {
    setNodeMaxListeners(this.nodeListenerState, maxListeners);
    return this;
  }

  getMaxListeners(): number {
    return this.nodeListenerState.maxListeners;
  }

  protected emitLocal(event: OrdinaryEventName, args: unknown[]): void {
    const listeners = this.eventListeners.get(event);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      (listener as (...values: unknown[]) => void).apply(this, args);
    }
  }

  protected snapshotListeners(
    events: readonly OrdinaryEventName[],
  ): Map<OrdinaryEventName, Listener[]> {
    const snapshot = new Map<OrdinaryEventName, Listener[]>();
    for (const event of events) {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        snapshot.set(
          event,
          listeners.map((listener) => nodeOriginalListener(listener)),
        );
      }
    }
    return snapshot;
  }
}

/** Socket-side emitter with separate ordinary, incoming catch-all, and outgoing registries. */
export class Emitter {
  protected readonly eventListeners = new Map<OrdinaryEventName, Listener[]>();
  private anyListeners: AnyListener[] | undefined;
  private anyOutgoingListeners: AnyListener[] | undefined;

  on(event: string, listener: Listener): this {
    addListener(this.eventListeners, event, listener);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapper = function (this: Emitter, ...args: never[]): void {
      removeOrdinaryListener(this.eventListeners, event, wrapper);
      listener.apply(this, args);
    } as Listener;
    // component-emitter uses `.fn`; the server's Node wrapper uses `.listener`.
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
    // No argument replaces the backing array so earlier live lookups detach (#125).
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
    if (listener) removeFirst(this.anyOutgoingListeners, listener);
    else if (this.anyOutgoingListeners) this.anyOutgoingListeners = [];
    return this;
  }

  /**
   * Outgoing catch-alls run at the send site (#111). They skip reserved events and the
   * trailing ack, matching the measured 4.8.3 arguments.
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
   * Match direct or original `once` identity. The client removes the first duplicate;
   * the server's Node path removes the last (0017, #125), as measured on 4.8.3.
   */
  protected removeOne(event: string, listener: Listener): void {
    removeOrdinaryListener(this.eventListeners, event, listener);
  }

  removeAllListeners(event?: string): this {
    if (event === undefined) this.eventListeners.clear();
    else this.eventListeners.delete(event);
    return this;
  }

  /** Server inbound uses the shared tick; ClientSocket overrides this for adapter delay (#78). */
  scheduleReceive(deliver: () => void): void {
    defer(deliver);
  }

  /** Incoming catch-alls run before named listeners and skip locally dispatched lifecycle events. */
  dispatch(event: string, args: unknown[]): void {
    this.dispatchCatchAll(event, args);
    this.dispatchNamed(event, args);
  }

  protected dispatchCatchAll(event: string, args: unknown[]): void {
    if (this.anyListeners?.length && !RESERVED_EVENTS.has(event)) {
      for (const any of [...this.anyListeners]) {
        (any as (...a: unknown[]) => void)(event, ...args);
      }
    }
  }

  protected dispatchNamed(event: string, args: unknown[]): void {
    const list = this.eventListeners.get(event);
    if (!list) return;
    for (const listener of [...list]) {
      (listener as (...values: unknown[]) => void).apply(this, args);
    }
  }
}

/**
 * Client-side component-emitter removal semantics, shared by connected and failed
 * clients; the server side follows Node instead (0017).
 */
export class ClientEmitter extends Emitter {
  readonly addEventListener = this.on;

  /** component-emitter returns the stable backing array while this key exists. */
  listeners = ((event: string) =>
    (this.eventListeners.get(event) ?? []) as AnyListener[]) as ClientSocketContract['listeners'];

  /** component-emitter derives this directly from the current live-array length. */
  hasListeners = ((event: string) =>
    this.listeners(event).length > 0) as ClientSocketContract['hasListeners'];

  off(event?: string, listener?: Listener): this {
    if (event === undefined) {
      this.eventListeners.clear();
    } else if (listener === undefined) {
      this.eventListeners.delete(event);
    } else {
      this.removeOne(event, listener);
    }
    return this;
  }

  readonly removeListener = this.off;
  override readonly removeAllListeners = this.off;
  readonly removeEventListener = this.off;
}

// Arrays retain duplicate registrations, matching Socket.IO (#125).
function addListener(
  map: Map<OrdinaryEventName, Listener[]>,
  event: OrdinaryEventName,
  listener: Listener,
): void {
  const list = map.get(event) ?? [];
  list.push(listener);
  map.set(event, list);
}

export function createNodeListenerState(): NodeListenerState {
  return { warnedEvents: new Set(), maxListeners: 10 };
}

function describeNodeReceivedValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') {
    const name = Object.prototype.toString.call(value).slice(8, -1);
    return `an instance of ${name}`;
  }
  const rendered = typeof value === 'string' ? `'${value}'` : String(value);
  return `type ${typeof value} (${rendered})`;
}

export function assertNodeListener(listener: unknown): asserts listener is Listener {
  if (typeof listener !== 'function') {
    throw new TypeError(
      `The "listener" argument must be of type function. Received ${describeNodeReceivedValue(listener)}`,
    );
  }
}

export function addNodeListener(
  receiver: object,
  map: Map<OrdinaryEventName, Listener[]>,
  state: NodeListenerState,
  emitMeta: EmitNodeMeta,
  event: OrdinaryEventName,
  listener: Listener,
  prepend = false,
  exposedListener = listener,
): void {
  assertNodeListener(listener);
  if (map.get('newListener')?.length) emitMeta('newListener', event, exposedListener);
  if (!map.has(event)) state.warnedEvents.delete(event);
  const listeners = map.get(event);
  if (listeners) {
    if (prepend) listeners.unshift(listener);
    else listeners.push(listener);
  } else {
    map.set(event, [listener]);
  }
  const count = listeners ? listeners.length : 1;
  if (state.maxListeners === 0 || count <= state.maxListeners || state.warnedEvents.has(event)) {
    return;
  }
  state.warnedEvents.add(event);
  emitMaxListenersWarning(receiver, event, count);
}

export function removeNodeListener(
  map: Map<OrdinaryEventName, Listener[]>,
  emitMeta: EmitNodeMeta,
  event: OrdinaryEventName,
  listener: Listener,
): void {
  assertNodeListener(listener);
  const removingFinalObserver = event === 'removeListener' && map.get(event)?.length === 1;
  const removed = removeOrdinaryListener(map, event, listener, true);
  if (
    removed &&
    (map.get('removeListener')?.length ||
      (removingFinalObserver && HOST_EMITS_FINAL_REMOVE_LISTENER_META_EVENT))
  ) {
    emitMeta('removeListener', event, nodeOriginalListener(removed));
  }
}

export function removeAllNodeListeners(
  map: Map<OrdinaryEventName, Listener[]>,
  state: NodeListenerState,
  remove: (event: OrdinaryEventName, listener: Listener) => unknown,
  event?: OrdinaryEventName,
): void {
  if (event === undefined) {
    const ordinaryNames = new Set(map.keys());
    ordinaryNames.delete('removeListener');
    for (const name of ordinaryNames) removeAllNodeListeners(map, state, remove, name);
    removeAllNodeListeners(map, state, remove, 'removeListener');
    state.warnedEvents.clear();
    return;
  }
  const listeners = [...(map.get(event) ?? [])];
  for (const listener of listeners.reverse()) remove(event, listener);
  state.warnedEvents.delete(event);
}

export function nodeListeners(
  map: ReadonlyMap<OrdinaryEventName, readonly Listener[]>,
  event: OrdinaryEventName,
): Listener[] {
  return (map.get(event) ?? []).map((entry) => nodeOriginalListener(entry));
}

export function nodeRawListeners(
  map: ReadonlyMap<OrdinaryEventName, readonly Listener[]>,
  event: OrdinaryEventName,
): Listener[] {
  return [...(map.get(event) ?? [])];
}

export function nodeListenerCount(
  map: ReadonlyMap<OrdinaryEventName, readonly Listener[]>,
  event: OrdinaryEventName,
  listener?: Listener,
): number {
  const entries = map.get(event) ?? [];
  return listener === undefined
    ? entries.length
    : entries.filter(
        (entry) => entry === listener || (entry as { listener?: Listener }).listener === listener,
      ).length;
}

export function setNodeMaxListeners(state: NodeListenerState, maxListeners: number): void {
  if (typeof maxListeners !== 'number' || maxListeners < 0 || Number.isNaN(maxListeners)) {
    throw new RangeError('The value of "n" is out of range. It must be a non-negative number.');
  }
  state.maxListeners = maxListeners;
}

/** Match EventEmitter's property-key order for integer strings, other strings, and symbols. */
export function nodeEventNames(
  map: ReadonlyMap<OrdinaryEventName, readonly Listener[]>,
): (string | symbol)[] {
  return Reflect.ownKeys(Object.fromEntries([...map.keys()].map((event) => [event, true])));
}

function emitMaxListenersWarning(emitter: object, event: OrdinaryEventName, count: number): void {
  const processHost = (
    globalThis as typeof globalThis & {
      process?: { emitWarning?: (warning: Error) => void };
    }
  ).process;
  if (!processHost?.emitWarning) return;
  const warning = Object.assign(
    new Error(
      `Possible EventEmitter memory leak detected. ${count} ${String(event)} listeners added.`,
    ),
    { name: 'MaxListenersExceededWarning', emitter, type: event, count },
  );
  processHost.emitWarning(warning);
}

function removeFirst<Entry>(list: Entry[] | undefined, listener: Entry): void {
  if (!list) return;
  const i = list.indexOf(listener);
  if (i !== -1) list.splice(i, 1);
}

/** Catch-all arrays use separate removal because their live-array detach rules differ. */
function removeOrdinaryListener(
  map: Map<OrdinaryEventName, Listener[]>,
  event: OrdinaryEventName,
  listener: Listener,
  fromEnd = false,
): Listener | undefined {
  const list = map.get(event);
  if (!list) return;
  let removed: Listener | undefined;
  if (fromEnd) {
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i];
      if (entry !== undefined && isListener(entry, listener, true)) {
        list.splice(i, 1);
        removed = entry;
        break;
      }
    }
  } else {
    const index = list.findIndex((entry) => isListener(entry, listener, false));
    if (index !== -1) removed = list.splice(index, 1)[0];
  }
  if (list.length === 0) map.delete(event);
  return removed;
}

/** Unwrap Node's `once` callback identity without recognizing component-emitter wrappers. */
function nodeOriginalListener(listener: Listener): Listener {
  return (listener as { listener?: Listener }).listener ?? listener;
}

/** Match the direct listener or only the wrapper property used by this emitter side. */
function isListener(entry: Listener, listener: Listener, nodeSide: boolean): boolean {
  const wrapper = entry as { fn?: Listener; listener?: Listener };
  return entry === listener || (nodeSide ? wrapper.listener === listener : wrapper.fn === listener);
}
