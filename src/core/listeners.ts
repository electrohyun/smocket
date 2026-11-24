import { hostEmitsFinalRemoveListenerMetaEvent } from '../host-emitter';

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

/** Browser-safe Node EventEmitter listener bookkeeping. */
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
    let fired = false;
    const wrapper = ((...args: never[]) => {
      if (fired) return;
      this.removeListener(event, wrapper);
      fired = true;
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
    let fired = false;
    const wrapper = ((...args: never[]) => {
      if (fired) return;
      this.removeListener(event, wrapper);
      fired = true;
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

/** Catch-all arrays use separate removal because their live-array detach rules differ. */
export function removeOrdinaryListener(
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
