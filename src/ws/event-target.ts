import type { ByteBuffer, EventListenerOptions, RawData } from './contracts';
import { SocketCloseEvent, SocketErrorEvent, SocketEvent, SocketMessageEvent } from './events';
import type {
  SocketEventHandler,
  SocketEventListener,
  SocketEventMap,
  SocketEventName,
} from './events';
import type { WebSocket } from './runtime';

export interface SocketEvents {
  open: [];
  message: [data: RawData, isBinary: boolean];
  error: [error: Error];
  close: [code: number, reason: ByteBuffer];
}

type Registration<Event extends SocketEventName> = {
  handler: SocketEventListener<Event>;
  property: boolean;
};
const factories: {
  [Event in SocketEventName]: (
    target: WebSocket,
    clean: boolean,
    ...args: SocketEvents[Event]
  ) => SocketEventMap[Event];
} = {
  open: (target) => new SocketEvent('open', target),
  message: (target, _clean, data, binary) =>
    new SocketMessageEvent(target, binary ? data : data.toString()),
  error: (target, _clean, error) => new SocketErrorEvent(target, error, error.message ?? ''),
  close: (target, clean, code, reason) =>
    new SocketCloseEvent(target, code, reason.toString(), clean),
};

/** Metadata follows live EventEmitter wrappers, including once and manual removal. */
export class WsEventTarget {
  private readonly registrations: {
    [Event in SocketEventName]: WeakMap<object, Registration<Event>>;
  } = { open: new WeakMap(), message: new WeakMap(), error: new WeakMap(), close: new WeakMap() };

  constructor(
    private readonly socket: WebSocket,
    private readonly wasClean: () => boolean,
  ) {}

  add<Event extends SocketEventName>(
    type: Event,
    handler: SocketEventListener<Event>,
    options: EventListenerOptions = {},
    property = false,
  ): void {
    if (!Object.hasOwn(factories, type)) return;
    for (const listener of this.socket.listeners(type)) {
      const record = this.registrations[type].get(listener);
      if (!property && record?.handler === handler && !record.property) return;
    }
    const wrapper = (...args: SocketEvents[Event]) => {
      const event = factories[type](this.socket, this.wasClean(), ...args);
      if (typeof handler === 'function') handler.call(this.socket, event);
      else handler.handleEvent(event);
    };
    this.registrations[type].set(wrapper, { handler, property });
    if (options.once) this.socket.once(type, wrapper);
    else this.socket.on(type, wrapper);
  }

  remove<Event extends SocketEventName>(type: Event, handler: SocketEventListener<Event>): void {
    if (!Object.hasOwn(factories, type)) return;
    for (const listener of this.socket.listeners(type)) {
      const record = this.registrations[type].get(listener);
      if (record?.handler === handler && !record.property) {
        this.socket.removeListener(type, listener);
        return;
      }
    }
  }

  get<Event extends SocketEventName>(type: Event): SocketEventHandler<Event> | null {
    for (const listener of this.socket.listeners(type)) {
      const record = this.registrations[type].get(listener);
      if (record?.property && typeof record.handler === 'function') return record.handler;
    }
    return null;
  }

  set<Event extends SocketEventName>(type: Event, handler: SocketEventHandler<Event> | null): void {
    for (const listener of this.socket.listeners(type)) {
      if (this.registrations[type].get(listener)?.property) {
        this.socket.removeListener(type, listener);
        break;
      }
    }
    if (typeof handler === 'function') this.add(type, handler, {}, true);
  }
}
