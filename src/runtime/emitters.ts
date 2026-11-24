import type { ClientSocketContract } from '../contract';
import { removeOrdinaryListener } from '../core/listeners';
import type { Listener, OrdinaryEventName } from '../core/listeners';
import { defer, RESERVED_EVENTS } from './delivery';

export type AnyListener = Listener;

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
      any.apply(this, [event, ...outgoing]);
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
        any.apply(this, [event, ...args]);
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

function removeFirst<Entry>(list: Entry[] | undefined, listener: Entry): void {
  if (!list) return;
  const i = list.indexOf(listener);
  if (i !== -1) list.splice(i, 1);
}
