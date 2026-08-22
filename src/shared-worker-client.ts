import type {
  AnyListener,
  ClientAllButLast,
  ClientLast,
  DefaultEventsMap,
  EventName,
  EventParams,
  EventsMap,
  FirstClientAckValue,
  ReservedOrUserEventName,
  ReservedOrUserListener,
} from './contract';
import {
  SHARED_WORKER_MESSAGE_TYPES,
  SHARED_WORKER_PROTOCOL_VERSION,
  readSharedWorkerHostMessage,
  type SharedWorkerClientEventMessage,
  type SharedWorkerConnectMessage,
  type SharedWorkerDisconnectMessage,
  type SharedWorkerHostMessage,
  type SharedWorkerPageMessage,
  type SharedWorkerServerAcknowledgementMessage,
  type SharedWorkerServerEventMessage,
} from './shared-worker-protocol';

type Listener = (...args: unknown[]) => void;

/** Lifecycle events emitted locally by the intentionally narrow page facade. */
export interface SharedWorkerSocketReservedEvents {
  connect: () => void;
  connect_error: (error: Error) => void;
  disconnect: (reason: string) => void;
  bridge_error: (error: Error) => void;
}

/** Inputs read by each explicit SharedWorker connection attempt. */
export interface SharedWorkerConnectOptions {
  url: string;
  auth?: Record<string, unknown>;
}

/**
 * The browser API supported by the SharedWorker bridge. It is deliberately
 * independent of the complete Socket.IO Client contract (ADR 0038).
 */
export interface SharedWorkerSocket<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
> {
  readonly id: string | undefined;
  readonly connected: boolean;
  readonly disconnected: boolean;
  auth: Record<string, unknown>;
  on<Event extends ReservedOrUserEventName<SharedWorkerSocketReservedEvents, ListenEvents>>(
    event: Event,
    listener: ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>,
  ): this;
  once<Event extends ReservedOrUserEventName<SharedWorkerSocketReservedEvents, ListenEvents>>(
    event: Event,
    listener: ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>,
  ): this;
  off<Event extends ReservedOrUserEventName<SharedWorkerSocketReservedEvents, ListenEvents>>(
    event?: Event,
    listener?: ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>,
  ): this;
  listeners<Event extends ReservedOrUserEventName<SharedWorkerSocketReservedEvents, ListenEvents>>(
    event: Event,
  ): Array<ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>>;
  removeAllListeners(event?: string): this;
  onAny(listener: AnyListener): this;
  offAny(listener?: AnyListener): this;
  listenersAny(): AnyListener[];
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): this;
  // Socket.IO keeps `send` permissive even when an event map is supplied.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(...args: any[]): this;
  emitWithAck<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: ClientAllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstClientAckValue<ClientLast<EventParams<EmitEvents, Event>>>>;
  connect(): this;
  open(): this;
  disconnect(): this;
  close(): this;
}

interface BufferedEmission {
  readonly event: string;
  readonly args: unknown[];
  readonly acknowledge?: Listener;
}

interface ServerAcknowledgementReference {
  owner: SharedWorkerSocketImplementation | undefined;
  readonly generation: number;
  readonly ackId: string;
}

interface SharedWorkerPageLifecycle {
  addEventListener(type: 'pagehide', listener: () => void, options: { once: true }): void;
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

const RESERVED_EVENTS = new Set([
  'connect',
  'connect_error',
  'disconnect',
  'disconnecting',
  'bridge_error',
  'newListener',
  'removeListener',
]);

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function removeFirst(list: Listener[] | undefined, listener: Listener): void {
  if (!list) return;
  const index = list.findIndex(
    (entry) => entry === listener || (entry as Listener & { fn?: Listener }).fn === listener,
  );
  if (index !== -1) list.splice(index, 1);
}

function pageLifecycle(): SharedWorkerPageLifecycle | undefined {
  const candidate = globalThis as typeof globalThis & Partial<SharedWorkerPageLifecycle>;
  if (
    typeof candidate.addEventListener !== 'function' ||
    typeof candidate.removeEventListener !== 'function'
  ) {
    return undefined;
  }
  return candidate as SharedWorkerPageLifecycle;
}

class SharedWorkerSocketImplementation<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
> implements SharedWorkerSocket<ListenEvents, EmitEvents> {
  id: string | undefined;
  connected = false;
  auth: Record<string, unknown>;

  private readonly listenersByEvent = new Map<string, Listener[]>();
  private anyListeners: Listener[] | undefined;
  private readonly outgoingBuffer: BufferedEmission[] = [];
  private readonly pendingClientAcknowledgements = new Map<string, Listener>();
  private readonly pendingServerAcknowledgements = new Set<ServerAcknowledgementReference>();
  private requestSequence = 0;
  private acknowledgementSequence = 0;
  private requestId: string | undefined;
  private generation: number | undefined;
  private connecting = false;
  private disconnecting = false;
  private disconnectAfterConnect = false;
  private readonly lifecycle = pageLifecycle();
  private observingPageHide = false;
  private readonly handlePageHide = (): void => {
    this.observingPageHide = false;
    this.disconnect();
  };

  constructor(
    private readonly port: MessagePort,
    private readonly url: string,
    auth: Record<string, unknown>,
  ) {
    this.auth = auth;
    port.addEventListener('message', (event: MessageEvent<unknown>) => this.receive(event.data));
    port.addEventListener('messageerror', () => {
      this.dispatchBridgeError(new Error('shared-worker message could not be deserialized'));
    });
    port.start();
    this.connect();
  }

  get disconnected(): boolean {
    return !this.connected;
  }

  on<Event extends ReservedOrUserEventName<SharedWorkerSocketReservedEvents, ListenEvents>>(
    event: Event,
    listener: ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>,
  ): this {
    const listeners = this.listenersByEvent.get(event) ?? [];
    listeners.push(listener as Listener);
    this.listenersByEvent.set(event, listeners);
    return this;
  }

  once<Event extends ReservedOrUserEventName<SharedWorkerSocketReservedEvents, ListenEvents>>(
    event: Event,
    listener: ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>,
  ): this {
    const original = listener as Listener;
    const wrapper = ((...args: unknown[]) => {
      this.off(event, wrapper as typeof listener);
      original.apply(this, args);
    }) as Listener & { fn?: Listener };
    wrapper.fn = original;
    return this.on(event, wrapper as typeof listener);
  }

  off<Event extends ReservedOrUserEventName<SharedWorkerSocketReservedEvents, ListenEvents>>(
    event?: Event,
    listener?: ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>,
  ): this {
    if (event === undefined) this.listenersByEvent.clear();
    else if (listener === undefined) this.listenersByEvent.delete(event);
    else {
      const listeners = this.listenersByEvent.get(event);
      removeFirst(listeners, listener as Listener);
      if (listeners?.length === 0) this.listenersByEvent.delete(event);
    }
    return this;
  }

  listeners<Event extends ReservedOrUserEventName<SharedWorkerSocketReservedEvents, ListenEvents>>(
    event: Event,
  ): Array<ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>> {
    return (this.listenersByEvent.get(event) ?? []) as Array<
      ReservedOrUserListener<SharedWorkerSocketReservedEvents, ListenEvents, Event>
    >;
  }

  removeAllListeners(event?: string): this {
    if (event === undefined) this.listenersByEvent.clear();
    else this.listenersByEvent.delete(event);
    return this;
  }

  onAny(listener: AnyListener): this {
    (this.anyListeners ??= []).push(listener as Listener);
    return this;
  }

  offAny(listener?: AnyListener): this {
    if (listener === undefined) {
      if (this.anyListeners) this.anyListeners = [];
    } else {
      removeFirst(this.anyListeners, listener as Listener);
    }
    return this;
  }

  listenersAny(): AnyListener[] {
    return (this.anyListeners ?? []) as AnyListener[];
  }

  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...incomingArgs: EventParams<EmitEvents, Event>
  ): this {
    this.queueEmission(event, incomingArgs);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(...args: any[]): this {
    this.queueEmission('message', args);
    return this;
  }

  emitWithAck<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: ClientAllButLast<EventParams<EmitEvents, Event>>
  ): Promise<FirstClientAckValue<ClientLast<EventParams<EmitEvents, Event>>>> {
    type Result = FirstClientAckValue<ClientLast<EventParams<EmitEvents, Event>>>;
    return new Promise<Result>((resolve) => {
      const acknowledge = (...values: unknown[]): void => resolve(values[0] as Result);
      this.queueEmission(event, [...args, acknowledge]);
    });
  }

  connect(): this {
    if (this.connected && !this.disconnecting) return this;

    this.releaseGeneration();
    this.observePageHide();
    this.disconnectAfterConnect = false;
    this.disconnecting = false;
    this.connecting = true;
    const requestId = `connect:${++this.requestSequence}`;
    this.requestId = requestId;
    const message: SharedWorkerConnectMessage = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.connect,
      requestId,
      url: this.url,
      auth: this.auth,
    };
    if (!this.post(message)) {
      this.connecting = false;
      this.requestId = undefined;
      this.stopObservingPageHide();
    }
    return this;
  }

  open(): this {
    return this.connect();
  }

  disconnect(): this {
    if (this.disconnecting || (!this.connected && !this.connecting)) return this;
    this.stopObservingPageHide();
    if (!this.connected || this.generation === undefined || this.requestId === undefined) {
      this.disconnectAfterConnect = true;
      return this;
    }

    const requestId = this.requestId;
    const generation = this.generation;
    this.disconnecting = true;
    this.connected = false;
    this.id = undefined;
    this.releaseAcknowledgements();
    const message: SharedWorkerDisconnectMessage = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.disconnect,
      requestId,
      generation,
      reason: 'io client disconnect',
    };
    this.post(message);
    this.dispatch('disconnect', ['io client disconnect']);
    return this;
  }

  close(): this {
    return this.disconnect();
  }

  private queueEmission(event: string, incomingArgs: unknown[]): void {
    if (RESERVED_EVENTS.has(event)) throw new Error(`"${event}" is a reserved event name`);
    const args = [...incomingArgs];
    const candidate = args.at(-1);
    const acknowledge = typeof candidate === 'function' ? (args.pop() as Listener) : undefined;
    const emission: BufferedEmission = { event, args, ...(acknowledge ? { acknowledge } : {}) };
    if (!this.connected || this.generation === undefined || this.disconnecting) {
      this.outgoingBuffer.push(emission);
      return;
    }
    this.postEmission(emission, this.generation);
  }

  private postEmission(emission: BufferedEmission, generation: number): void {
    const ackId = emission.acknowledge
      ? `client:${generation}:${++this.acknowledgementSequence}`
      : undefined;
    if (ackId && emission.acknowledge) {
      this.pendingClientAcknowledgements.set(ackId, emission.acknowledge);
    }
    const message: SharedWorkerClientEventMessage = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.clientEvent,
      generation,
      event: emission.event,
      args: emission.args,
      ...(ackId ? { ackId } : {}),
    };
    if (!this.post(message) && ackId) this.pendingClientAcknowledgements.delete(ackId);
  }

  private flushOutgoing(): void {
    const generation = this.generation;
    if (generation === undefined) return;
    const buffered = this.outgoingBuffer.splice(0);
    for (const [index, emission] of buffered.entries()) {
      if (!this.connected || this.generation !== generation || this.disconnecting) {
        this.outgoingBuffer.unshift(...buffered.slice(index));
        return;
      }
      this.postEmission(emission, generation);
    }
  }

  private receive(value: unknown): void {
    let message: SharedWorkerHostMessage;
    try {
      message = readSharedWorkerHostMessage(value);
    } catch (error) {
      this.dispatchBridgeError(errorValue(error));
      return;
    }

    if (message.type === SHARED_WORKER_MESSAGE_TYPES.bridgeError) {
      if (message.requestId !== undefined && message.requestId !== this.requestId) return;
      if (message.generation !== undefined && message.generation !== this.generation) return;
      this.dispatchBridgeError(new Error(message.error));
      return;
    }

    if (message.type === SHARED_WORKER_MESSAGE_TYPES.connected) {
      this.receiveConnected(message);
      return;
    }
    if (message.type === SHARED_WORKER_MESSAGE_TYPES.connectError) {
      if (message.requestId !== this.requestId || !this.connecting) return;
      this.connecting = false;
      this.generation = undefined;
      this.id = undefined;
      this.connected = false;
      this.stopObservingPageHide();
      this.dispatch('connect_error', [new Error(message.error)]);
      return;
    }

    if (
      message.generation !== this.generation ||
      ('requestId' in message && message.requestId !== this.requestId)
    ) {
      return;
    }
    if (message.type === SHARED_WORKER_MESSAGE_TYPES.serverEvent) {
      if (this.connected && !this.disconnecting) this.receiveServerEvent(message);
    } else if (message.type === SHARED_WORKER_MESSAGE_TYPES.acknowledgement) {
      if (!this.connected || this.disconnecting) return;
      const acknowledge = this.pendingClientAcknowledgements.get(message.ackId);
      if (!acknowledge) return;
      this.pendingClientAcknowledgements.delete(message.ackId);
      acknowledge(...message.args);
    } else {
      const shouldNotify = this.connected && !this.disconnecting;
      this.connecting = false;
      this.disconnecting = false;
      this.releaseGeneration();
      if (shouldNotify) this.dispatch('disconnect', [message.reason]);
    }
  }

  private receiveConnected(message: Extract<SharedWorkerHostMessage, { type: 'CONNECTED' }>): void {
    if (message.requestId !== this.requestId || !this.connecting) return;
    this.generation = message.generation;
    this.id = message.id;
    this.connected = true;
    this.connecting = false;
    this.acknowledgementSequence = 0;

    if (this.disconnectAfterConnect) {
      this.disconnectAfterConnect = false;
      this.disconnect();
      return;
    }

    this.flushOutgoing();
    if (this.connected && this.generation === message.generation) this.dispatch('connect', []);
  }

  private receiveServerEvent(message: SharedWorkerServerEventMessage): void {
    const args = [...message.args];
    if (message.ackId) {
      const reference: ServerAcknowledgementReference = {
        owner: this,
        generation: message.generation,
        ackId: message.ackId,
      };
      this.pendingServerAcknowledgements.add(reference);
      args.push((...acknowledgementArgs: unknown[]) => {
        const owner = reference.owner;
        reference.owner = undefined;
        if (!owner) return;
        owner.pendingServerAcknowledgements.delete(reference);
        owner.postServerAcknowledgement(reference, acknowledgementArgs);
      });
    }
    this.dispatch(message.event, args);
  }

  private postServerAcknowledgement(
    reference: ServerAcknowledgementReference,
    args: unknown[],
  ): void {
    if (!this.connected || this.disconnecting || this.generation !== reference.generation) {
      return;
    }
    const message: SharedWorkerServerAcknowledgementMessage = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
      generation: reference.generation,
      direction: 'server',
      ackId: reference.ackId,
      args,
    };
    this.post(message);
  }

  private post(message: SharedWorkerPageMessage): boolean {
    try {
      this.port.postMessage(message);
      return true;
    } catch (error) {
      this.dispatchBridgeError(
        new Error(`could not clone page message: ${errorValue(error).message}`),
      );
      return false;
    }
  }

  private releaseAcknowledgements(): void {
    this.pendingClientAcknowledgements.clear();
    for (const reference of this.pendingServerAcknowledgements) reference.owner = undefined;
    this.pendingServerAcknowledgements.clear();
  }

  private releaseGeneration(): void {
    this.connected = false;
    this.id = undefined;
    this.generation = undefined;
    this.releaseAcknowledgements();
    this.stopObservingPageHide();
  }

  private observePageHide(): void {
    if (!this.lifecycle || this.observingPageHide) return;
    this.lifecycle.addEventListener('pagehide', this.handlePageHide, { once: true });
    this.observingPageHide = true;
  }

  private stopObservingPageHide(): void {
    if (!this.lifecycle || !this.observingPageHide) return;
    this.lifecycle.removeEventListener('pagehide', this.handlePageHide);
    this.observingPageHide = false;
  }

  private dispatchBridgeError(error: Error): void {
    this.dispatch('bridge_error', [error]);
  }

  private dispatch(event: string, args: unknown[]): void {
    if (!RESERVED_EVENTS.has(event) && this.anyListeners?.length) {
      for (const listener of [...this.anyListeners]) listener(event, ...args);
    }
    const listeners = this.listenersByEvent.get(event);
    if (!listeners) return;
    for (const listener of [...listeners]) listener.apply(this, args);
  }
}

/** Connect a caller-owned SharedWorker port through the explicit narrow facade. */
export function connectSharedWorker<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
>(
  port: MessagePort,
  options: SharedWorkerConnectOptions,
): SharedWorkerSocket<ListenEvents, EmitEvents> {
  return new SharedWorkerSocketImplementation<ListenEvents, EmitEvents>(
    port,
    options.url,
    options.auth ?? {},
  );
}
