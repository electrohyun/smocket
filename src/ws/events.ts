import type { Data } from './contracts';
import type { WebSocket } from './runtime';

/** ws supplies its own event objects rather than the host's DOM Event classes. */
export class SocketEvent {
  #type: string;
  #target: WebSocket;

  constructor(type: string, target: WebSocket) {
    this.#type = type;
    this.#target = target;
  }

  get target(): WebSocket {
    return this.#target;
  }
  get type(): string {
    return this.#type;
  }
}

export class SocketMessageEvent extends SocketEvent {
  #data: Data;

  constructor(target: WebSocket, data: Data) {
    super('message', target);
    this.#data = data;
  }

  get data(): Data {
    return this.#data;
  }
}

export class SocketErrorEvent extends SocketEvent {
  #error: unknown;
  #message: string;

  constructor(target: WebSocket, error: unknown, message: string) {
    super('error', target);
    this.#error = error;
    this.#message = message;
  }

  get error(): unknown {
    return this.#error;
  }
  get message(): string {
    return this.#message;
  }
}

export class SocketCloseEvent extends SocketEvent {
  #code: number;
  #reason: string;
  #wasClean: boolean;

  constructor(target: WebSocket, code: number, reason: string, wasClean: boolean) {
    super('close', target);
    this.#code = code;
    this.#reason = reason;
    this.#wasClean = wasClean;
  }

  get code(): number {
    return this.#code;
  }
  get reason(): string {
    return this.#reason;
  }
  get wasClean(): boolean {
    return this.#wasClean;
  }
}

export interface SocketEventMap {
  open: SocketEvent;
  message: SocketMessageEvent;
  error: SocketErrorEvent;
  close: SocketCloseEvent;
}
export type SocketEventName = keyof SocketEventMap;
export type SocketEventHandler<Event extends SocketEventName> = (
  this: WebSocket,
  event: SocketEventMap[Event],
) => void;
export type SocketEventListener<Event extends SocketEventName> =
  SocketEventHandler<Event> | { handleEvent(event: SocketEventMap[Event]): void };

// ws exposes these read-only prototype getters during property enumeration.
for (const [prototype, properties] of [
  [SocketEvent.prototype, ['target', 'type']],
  [SocketMessageEvent.prototype, ['data']],
  [SocketErrorEvent.prototype, ['error', 'message']],
  [SocketCloseEvent.prototype, ['code', 'reason', 'wasClean']],
] as const) {
  for (const property of properties)
    Object.defineProperty(prototype, property, { enumerable: true });
}
