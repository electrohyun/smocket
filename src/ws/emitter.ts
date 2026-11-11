import { NodeEmitter, removeNodeListener } from '../runtime/emitters';
import type { Listener, OrdinaryEventName } from '../runtime/emitters';

type RawListener = Listener & { listener?: Listener };

/** Reuse listener storage while keeping ws aliases and typed receiver callbacks. */
export class WsEmitter<Events extends { [Event in keyof Events]: unknown[] }> extends NodeEmitter {
  on<Event extends keyof Events>(
    event: Event,
    listener: (this: this, ...args: Events[Event]) => void,
  ): this;
  on(event: OrdinaryEventName, listener: (this: this, ...args: Parameters<Listener>) => void): this;
  override on(event: OrdinaryEventName, listener: Listener): this {
    return super.on(event, listener);
  }

  override readonly addListener = this.on;

  once<Event extends keyof Events>(
    event: Event,
    listener: (this: this, ...args: Events[Event]) => void,
  ): this;
  once(
    event: OrdinaryEventName,
    listener: (this: this, ...args: Parameters<Listener>) => void,
  ): this;
  override once(event: OrdinaryEventName, listener: Listener): this {
    return super.once(event, listener);
  }

  removeListener<Event extends keyof Events>(
    event: Event,
    listener: (this: this, ...args: Events[Event]) => void,
  ): this;
  removeListener(
    event: OrdinaryEventName,
    listener: (this: this, ...args: Parameters<Listener>) => void,
  ): this;
  override removeListener(event: OrdinaryEventName, listener: Listener): this {
    this.removeWsListener(event, listener, event);
    return this;
  }

  override readonly off = this.removeListener;

  override removeAllListeners(event?: OrdinaryEventName): this {
    if (arguments.length === 0) return super.removeAllListeners();
    if (event !== undefined) return super.removeAllListeners(event);

    // Node treats explicit undefined as the "undefined" key, retaining the
    // original undefined argument in removeListener notifications.
    for (const listener of this.rawListeners('undefined').reverse()) {
      this.removeWsListener('undefined', listener, undefined);
    }
    return this;
  }

  private removeWsListener(
    event: OrdinaryEventName,
    listener: Listener,
    notificationEvent: OrdinaryEventName | undefined,
  ): void {
    // Node unwraps a sole once callback, but in a listener array it reports
    // the argument passed to removeListener (including the raw wrapper).
    const multiple = this.listenerCount(event) > 1;
    removeNodeListener(
      this.eventListeners,
      (meta, _name, original) => this.emit(meta, notificationEvent, multiple ? listener : original),
      event,
      listener,
    );
  }

  override rawListeners(event: OrdinaryEventName): RawListener[] {
    return super.rawListeners(event);
  }

  emit<Event extends keyof Events>(event: Event, ...args: Events[Event]): boolean;
  emit(event: OrdinaryEventName, ...args: Parameters<Listener>): boolean;
  override emit(event: OrdinaryEventName, ...args: unknown[]): boolean {
    const hasListeners = this.listenerCount(event) > 0;
    if (!hasListeners && event === 'error') {
      throw args[0] instanceof Error ? args[0] : new Error('Unhandled error event');
    }
    this.emitLocal(event, args);
    return hasListeners;
  }
}
