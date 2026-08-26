import type {
  AuthCallback,
  BroadcastContract,
  ClientSocketContract,
  ConnectOptions,
  Handshake,
  MiddlewareError,
  NamespaceContract,
  ServerSocketContract,
  SmocketAdapter,
  SocketMiddleware,
} from '../contract';
import { BroadcastOperator } from './broadcast';
import {
  asRooms,
  assertNotReservedEvent,
  defer,
  emitWithAck,
  type EncodedPayload,
  scheduleDelivery,
  send,
  sendEncoded,
  snapshotPayload,
  RESERVED_EVENTS,
  withAckTimeout,
} from './delivery';
import {
  addNodeListener,
  assertNodeListener,
  type AnyListener,
  ClientEmitter,
  createNodeListenerState,
  Emitter,
  type Listener,
  nodeEventNames,
  nodeListenerCount,
  nodeListeners,
  nodeRawListeners,
  type OrdinaryEventName,
  removeAllNodeListeners,
  removeNodeListener,
  setNodeMaxListeners,
} from './emitters';
import { Manager, type ManagerServerSocket } from './manager';

interface SocketFlags {
  volatile?: boolean;
  timeout?: number;
}
interface TimedCallbackCancellation {
  cancel(reason: Error): void;
  isSettled(): boolean;
}
type BufferedPacket = [string, unknown[], TimedCallbackCancellation?];
/** One pairing retained while connection middleware may complete repeatedly. */
export interface ConnectionAttempt {
  state: 'pending' | 'cancelled' | 'rejected' | 'connected';
  serverSocket?: ServerSocket;
}
export interface SocketNamespace extends NamespaceContract {
  readonly adapter: SmocketAdapter;
  readonly sockets: Map<string, ServerSocket>;
  pair(client: ClientSocket, source?: ConnectOptions): void;
}

export class ServerSocket extends Emitter implements ServerSocketContract {
  readonly id: string;
  connected = false;
  readonly recovered = false;
  private readonly packetMiddleware: SocketMiddleware[] = [];
  private readonly nodeListenerState = createNodeListenerState();
  readonly rooms = new Set<string>();
  /** Shared namespace identity for routing, delivery, and disconnect cleanup (#44, #45). */
  readonly nsp: SocketNamespace;
  /** Final connection handshake exposed to middleware and connection handlers (0006). */
  readonly handshake: Handshake;
  /** The first teardown owns the lifecycle; later disconnect paths await the same work. */
  private teardownPromise: Promise<void> | undefined;
  /** One connection-owned acknowledgement generation, invalidated by every teardown path. */
  private readonly acknowledgementState = { active: true };
  private active = true;
  /** Cleared by whole-socket cleanup so a disconnected socket cannot recreate membership. */
  private acceptsRoomJoins = true;
  private membershipCleaned = false;
  /** Per-socket store; reconnect creates a fresh object with the fresh socket (#108, 0013). */
  readonly data: Record<string, unknown> = {};
  private peer!: ClientSocket;
  private flags: SocketFlags = {};

  constructor(id: string, nsp: SocketNamespace, handshake: Handshake) {
    super();
    this.id = id;
    this.nsp = nsp;
    this.handshake = handshake;
    // Socket.IO starts with one removable noop `error` listener.
    this.on('error', () => {});
  }

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

  override on(event: OrdinaryEventName, listener: Listener): this {
    this.addNodeListener(event, listener);
    return this;
  }

  addListener(event: OrdinaryEventName, listener: Listener): this {
    return this.on(event, listener);
  }

  /** Fresh Node-style snapshot with `once` wrappers unwrapped. */
  listeners = ((event: OrdinaryEventName) =>
    nodeListeners(
      this.eventListeners,
      event,
    ) as AnyListener[]) as ServerSocketContract['listeners'];

  /** Optional listener identity also matches the original behind `once`. */
  listenerCount = ((event: OrdinaryEventName, listener?: Listener) => {
    return nodeListenerCount(this.eventListeners, event, listener);
  }) as ServerSocketContract['listenerCount'];

  rawListeners(event: OrdinaryEventName): Listener[] {
    return nodeRawListeners(this.eventListeners, event);
  }

  eventNames(): (string | symbol)[] {
    return nodeEventNames(this.eventListeners);
  }

  /** Node-compatible wrapper shape for `listeners()` and `rawListeners()`. */
  override once(event: OrdinaryEventName, listener: Listener): this {
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

  override removeAllListeners(event?: OrdinaryEventName): this {
    removeAllNodeListeners(
      this.eventListeners,
      this.nodeListenerState,
      (name, listener) => this.removeListener(name, listener),
      event,
    );
    return this;
  }

  setMaxListeners(maxListeners: number): this {
    setNodeMaxListeners(this.nodeListenerState, maxListeners);
    return this;
  }

  getMaxListeners(): number {
    return this.nodeListenerState.maxListeners;
  }

  use(middleware: SocketMiddleware): this {
    this.packetMiddleware.push(middleware);
    return this;
  }

  override dispatch(event: string, args: unknown[]): void {
    if (RESERVED_EVENTS.has(event) || this.packetMiddleware.length === 0) {
      super.dispatch(event, args);
      return;
    }

    this.dispatchCatchAll(event, args);
    const packet = [event, ...args] as [string, ...unknown[]];
    const chain = [...this.packetMiddleware];
    const run = (index: number): void => {
      const middleware = chain[index];
      if (!middleware) {
        defer(() => {
          if (!this.connected) return;
          const [nextEvent, ...nextArgs] = packet;
          this.dispatchNamed(nextEvent, nextArgs);
        });
        return;
      }
      middleware(packet, (error) => {
        if (error) {
          this.dispatchNamed('error', [error]);
          return;
        }
        run(index + 1);
      });
    };
    run(0);
  }

  attachPeer(client: ClientSocket): void {
    this.peer = client;
  }

  /**
   * Defer teardown behind already-queued inbound delivery to preserve FIFO. Emit
   * `disconnecting` with rooms intact, then clean membership and emit `disconnect`;
   * both receive socket.io's measured server-side reason.
   */
  private teardown(reason: string): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise;
    this.teardownPromise = new Promise((resolve) => {
      defer(() => {
        this.invalidateAcknowledgements();
        this.active = false;
        this.dispatch('disconnecting', [reason]);
        this.connected = false;
        this.cleanupMembership();
        this.dispatch('disconnect', [reason]);
        resolve();
      });
    });
    return this.teardownPromise;
  }

  /** Idempotently discard a pre-admission socket without lifecycle events. */
  cleanupConnectionAttempt(): void {
    this.invalidateAcknowledgements();
    this.active = false;
    this.cleanupMembership();
  }

  invalidateAcknowledgements(): void {
    this.acknowledgementState.active = false;
  }

  /** A middleware error after admission closes only the orphaned server Socket. */
  closeAfterRepeatedConnectionError(): void {
    void this.teardown('transport close');
  }

  /** Whole-socket membership cleanup shared by abandoned attempts and disconnect. */
  private cleanupMembership(): void {
    if (this.membershipCleaned) return;
    this.membershipCleaned = true;
    this.acceptsRoomJoins = false;
    for (const room of this.rooms) this.nsp.adapter.del(this.id, room);
    // Whole-socket cleanup owns reverse-index deletion without exposing `delAll` (#238).
    this.nsp.adapter.sids.delete(this.id);
    this.nsp.adapter.removeSocket?.(this.id);
    // Preserve the live `rooms` Set identity while emptying it.
    this.rooms.clear();
    this.nsp.sockets.delete(this.id);
  }

  /** Client initiation maps to socket.io's server-side disconnect reason. */
  handleDisconnect(): void {
    void this.teardown('client namespace disconnect');
  }

  /** Server-wide close: transport loss on the client, shutdown lifecycle here. */
  async closeFromServer(): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise;
    await this.teardown('server shutting down');
    if (this.peer.connected) this.peer.markDisconnected('transport close');
  }

  /** `close=true` tears down every namespace sharing the logical Manager (0028). */
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
    this.invalidateAcknowledgements();
    this.teardownPromise = Promise.resolve();
    this.active = false;
    this.dispatch('disconnecting', [reason]);
    this.connected = false;
    this.cleanupMembership();
    this.dispatch('disconnect', [reason]);
    return true;
  }

  markConnected(): void {
    this.connected = true;
  }

  isActive(): boolean {
    return this.active;
  }

  acknowledgementGuard(): () => boolean {
    const state = this.acknowledgementState;
    return () => state.active;
  }

  emit(event: string, ...args: unknown[]): boolean {
    assertNotReservedEvent(event);
    const flags = this.consumeFlags();
    const { args: deliveredArgs } = withAckTimeout(args, flags.timeout);
    if (flags.volatile && !this.peer.connected) return true;
    this.emitOutgoing(event, args);
    if (!this.active) return true;
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

  /** Observe the live source but deliver a decode of the frozen broadcast packet (0026). */
  sendBroadcast(
    event: string,
    sourceArgs: unknown[],
    payload: EncodedPayload,
    ack?: (...answer: unknown[]) => void,
  ): void {
    this.emitOutgoing(event, sourceArgs);
    sendEncoded(this.peer, event, payload, ack);
  }
  /** The next direct emit or broadcast operator consumes this timeout (#112). */
  timeout(ms: number): ServerSocket {
    this.flags.timeout = ms;
    return this;
  }

  compress(_compress: boolean): this {
    return this;
  }

  isClientReady(): boolean {
    return this.peer.connected;
  }

  get disconnected(): boolean {
    return !this.connected;
  }

  /** The next direct emit or broadcast operator consumes this volatile flag (0016). */
  get volatile(): this {
    this.flags.volatile = true;
    return this;
  }

  get broadcast(): BroadcastContract {
    return this.newBroadcastOperator([], [this.id]);
  }
  join(room: string | string[]): void {
    if (!this.acceptsRoomJoins) return;
    // Keep adapter indexes and the socket's live room view in step.
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
    return this.newBroadcastOperator(asRooms(room), [this.id]);
  }
  in(room: string | string[]): BroadcastContract {
    return this.to(room);
  }
  except(room: string | string[]): BroadcastContract {
    return this.newBroadcastOperator([], [...asRooms(room), this.id]);
  }

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

  private consumeFlags(): SocketFlags {
    const flags = this.flags;
    this.flags = {};
    return flags;
  }
}

function snapshotMiddlewareError(source: MiddlewareError): MiddlewareError {
  const [packet] = snapshotPayload([{ message: source.message, data: source.data }]) as [
    { message: string; data?: unknown },
  ];
  const error: MiddlewareError = new Error(packet.message);
  error.data = packet.data;
  return error;
}

export class ClientSocket extends ClientEmitter implements ClientSocketContract {
  connected = false;
  recovered = false;
  auth: Record<string, unknown> | AuthCallback;
  id: string | undefined;
  /** Shared host-neutral Manager identity across namespaces (0028). */
  readonly io: Manager;
  /** Stable namespace attachment used to re-pair after disconnect. */
  private nsp: SocketNamespace | undefined;
  /** Current pairing; reconnect replaces it because ids belong to connections. */
  private serverSocket!: ServerSocket;
  /** The only pairing still allowed to reach `connection` for this client. */
  private connectionAttempt: ConnectionAttempt | undefined;
  /** Pre-connect emits, flushed in order like socket.io-client's sendBuffer. */
  private sendBuffer: BufferedPacket[] = [];
  /**
   * Client Promise acks and sent timed callbacks settle on disconnect. Untimed
   * callbacks and acknowledgements sent by the server remain pending (0012).
   */
  private readonly pendingAcks = new Set<(reason: Error) => void>();
  private flags: SocketFlags = {};
  /** Stable query/options plus mutable `auth` rebuild each reconnect handshake. */
  private readonly handshakeSource?: ConnectOptions;
  /** Re-read a static namespace registered after `Invalid namespace`. */
  private readonly resolveNamespace?: () => SocketNamespace | undefined;
  /** Re-run parent admission after an `Invalid namespace` result. */
  private readonly dynamicAdmission?: (client: ClientSocket) => void;

  constructor(
    manager: Manager,
    nsp: SocketNamespace | undefined,
    source?: ConnectOptions,
    resolveNamespace?: () => SocketNamespace | undefined,
    dynamicAdmission?: (client: ClientSocket) => void,
  ) {
    super();
    this.io = manager;
    this.nsp = nsp;
    this.handshakeSource = source;
    this.auth = source?.auth ?? {};
    this.resolveNamespace = resolveNamespace;
    this.dynamicAdmission = dynamicAdmission;
  }

  attachNamespace(namespace: SocketNamespace): void {
    this.nsp = namespace;
  }

  connectionSource(): ConnectOptions {
    return { ...this.handshakeSource, auth: this.auth };
  }

  /** Adopt the fresh pairing, flush its buffered emits, then expose `connect`. */
  completeConnectionAttempt(attempt: ConnectionAttempt, serverSocket: ServerSocket): void {
    if (!this.isConnectionAttemptPending(attempt)) {
      if (attempt.state !== 'connected') serverSocket.cleanupConnectionAttempt();
      return;
    }
    attempt.state = 'connected';
    this.serverSocket = serverSocket;
    this.connected = true;
    this.recovered = false;
    this.id = serverSocket.id;
    this.io.connected(this);
    const buffered = this.sendBuffer;
    this.sendBuffer = [];
    for (const [index, packet] of buffered.entries()) {
      const [event, args, timedCallback] = packet;
      if (timedCallback?.isSettled()) continue;
      // Buffered packets are observed and encoded only when the connection flushes (0026).
      if (timedCallback) this.trackTimedCallback(timedCallback);
      this.emitOutgoing(event, args);
      if (!this.isConnectionAttemptConnected(attempt, serverSocket)) {
        const unflushed = buffered
          .slice(index)
          .filter(([, , cancellation]) => !cancellation?.isSettled());
        this.sendBuffer = [...unflushed, ...this.sendBuffer];
        return;
      }
      send(serverSocket, event, args);
    }
    // Flush while connected but before the public `connect` listener.
    this.dispatch('connect', []);
  }

  isConnectionAttemptConnected(attempt: ConnectionAttempt, serverSocket: ServerSocket): boolean {
    return (
      this.connectionAttempt === attempt &&
      attempt.state === 'connected' &&
      this.connected &&
      this.serverSocket === serverSocket
    );
  }

  repeatConnectionCompletion(): void {
    this.dispatch('connect', []);
  }

  reportRepeatedConnectionError(err: MiddlewareError): void {
    const snapshot = snapshotMiddlewareError(err);
    defer(() => this.dispatch('connect_error', [snapshot]));
  }

  /**
   * Apply adapter delay to client-inbound delivery by paired sid (#78). Delivery
   * from a `connection` handler precedes pairing and therefore uses the default tick.
   */
  override scheduleReceive(deliver: () => void): void {
    const paired: ServerSocket | undefined = this.serverSocket;
    if (paired) scheduleDelivery(paired.nsp.adapter, paired.id, deliver);
    else defer(deliver);
  }

  acknowledgementGuard(): () => boolean {
    const serverSocket = this.connectionAttempt?.serverSocket ?? this.serverSocket;
    return serverSocket.acknowledgementGuard();
  }

  /**
   * Defer middleware `connect_error` with its error/data while leaving the client
   * unpaired. App rejection is not logged like a missing-server failure (0005).
   */
  rejectConnectionAttempt(attempt: ConnectionAttempt, err: MiddlewareError): void {
    if (!this.isConnectionAttemptPending(attempt)) return;
    attempt.state = 'rejected';
    attempt.serverSocket?.cleanupConnectionAttempt();
    this.connectionAttempt = undefined;
    this.io.settlePending(this);
    const snapshot = snapshotMiddlewareError(err);
    defer(() => this.dispatch('connect_error', [snapshot]));
  }

  failInvalidNamespace(): void {
    defer(() => this.dispatch('connect_error', [new Error('Invalid namespace')]));
  }

  beginConnectionAttempt(): ConnectionAttempt | undefined {
    if (this.connected || this.connectionAttempt?.state === 'pending') return undefined;
    const attempt: ConnectionAttempt = { state: 'pending' };
    this.connectionAttempt = attempt;
    this.io.registerPending(this);
    return attempt;
  }

  attachConnectionAttempt(attempt: ConnectionAttempt, serverSocket: ServerSocket): boolean {
    if (!this.isConnectionAttemptPending(attempt) || attempt.serverSocket) return false;
    attempt.serverSocket = serverSocket;
    return true;
  }

  isConnectionAttemptPending(attempt: ConnectionAttempt): boolean {
    return this.connectionAttempt === attempt && attempt.state === 'pending';
  }

  ownsConnection(socket: ManagerServerSocket): boolean {
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

  cancelConnectionAttemptFromManager(): void {
    this.cancelConnectionAttempt();
  }

  emit(event: string, ...args: unknown[]): this {
    this.sendEvent(event, args, true);
    return this;
  }
  send(...args: unknown[]): this {
    return this.emit('message', ...args);
  }

  private sendEvent(
    event: string,
    args: unknown[],
    trackTimedCallback = false,
  ): ((reason: Error) => void) | undefined {
    assertNotReservedEvent(event);
    // Keep the live flag object armed until outgoing observation and packet creation finish (0026).
    const flags = this.flags;
    let bufferedPacket: BufferedPacket | undefined;
    const timed = withAckTimeout(args, flags.timeout, (cancel) => {
      if (trackTimedCallback) this.pendingAcks.delete(cancel);
      if (!bufferedPacket) return;
      const index = this.sendBuffer.indexOf(bufferedPacket);
      if (index !== -1) this.sendBuffer.splice(index, 1);
    });
    const timedCallback =
      timed.cancel && timed.isSettled
        ? { cancel: timed.cancel, isSettled: timed.isSettled }
        : undefined;
    if (flags.volatile && !this.connected) {
      this.consumeFlags();
      return timed.cancel;
    }
    // Before the connection completes, emits are buffered rather than lost, and
    // outgoing observation and encoding both wait for `completeConnection` (0026).
    if (!this.connected) {
      bufferedPacket = [event, timed.args, timedCallback];
      this.sendBuffer.push(bufferedPacket);
      this.consumeFlags();
      return timed.cancel;
    }
    if (timedCallback) this.trackTimedCallback(timedCallback);
    this.emitOutgoing(event, args);
    send(this.serverSocket, event, timed.args);
    this.consumeFlags();
    return timed.cancel;
  }

  private trackTimedCallback(timed: TimedCallbackCancellation): void {
    this.pendingAcks.add(timed.cancel);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    // Register promise-form acks so disconnect can reject them.
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

  timeout(ms: number): ClientSocket {
    this.flags.timeout = ms;
    return this;
  }

  compress(_compress: boolean): this {
    return this;
  }

  /** Volatile delivery drops instead of buffering when emitted while disconnected (0016). */
  get volatile(): this {
    this.flags.volatile = true;
    return this;
  }

  private consumeFlags(): SocketFlags {
    const flags = this.flags;
    this.flags = {};
    return flags;
  }

  connect(): this {
    // Reconnect gets a fresh socket/id/rooms while reusing its handshake source (0013).
    if (this.connected) return this;
    const namespace: SocketNamespace | undefined = this.nsp ?? this.resolveNamespace?.();
    if (!namespace) {
      if (this.dynamicAdmission) this.dynamicAdmission(this);
      else this.failInvalidNamespace();
      return this;
    }
    this.nsp = namespace;
    namespace.pair(this, this.connectionSource());
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
    // Client and server observe their distinct measured disconnect reasons.
    this.markDisconnected('io client disconnect');
    this.serverSocket.handleDisconnect();
    return this;
  }

  close(): this {
    return this.disconnect();
  }

  get disconnected(): boolean {
    return !this.connected;
  }

  /** Clear connection identity, reject tracked promise acks, and emit the measured reason. */
  markDisconnected(reason: string): void {
    // `markDisconnected` is reached only for a connected client, whose admitted
    // attempt remains retained until this teardown invalidates late completions.
    const attempt = this.connectionAttempt as ConnectionAttempt;
    attempt.state = 'cancelled';
    this.connectionAttempt = undefined;
    this.serverSocket.invalidateAcknowledgements();
    this.connected = false;
    this.id = undefined;
    this.io.disconnected(this);
    const rejecters = [...this.pendingAcks];
    this.pendingAcks.clear();
    for (const reject of rejecters) reject(new Error('socket has been disconnected'));
    this.dispatch('disconnect', [reason]);
  }

  disconnectFromServer(): void {
    if (this.connected) this.serverSocket.disconnectNamespaceFromServer();
  }
}

/**
 * Missing origins report one deferred `connect_error` and diagnostic, then stop.
 * Real socket.io retries forever, but network-driven retry has no mock source (0005).
 */
export class FailedClientSocket extends ClientEmitter implements ClientSocketContract {
  readonly connected = false;
  readonly disconnected = true;
  readonly recovered = false;
  readonly id = undefined;
  readonly io = undefined;
  auth: Record<string, unknown> | AuthCallback;
  private flags: SocketFlags = {};

  constructor(origin: string, auth: Record<string, unknown> | AuthCallback) {
    super();
    this.auth = auth;
    const message = `no server registered for ${origin}`;
    // Use the successful connection's tick boundary so the next-line handler sees it (0004).
    defer(() => {
      console.error(`[smocket] connect_error: ${message}`);
      this.dispatch('connect_error', [new Error(message)]);
    });
  }

  emit(event: string, ..._args: unknown[]): this {
    assertNotReservedEvent(event);
    this.flags = {};
    return this;
  }
  send(...args: unknown[]): this {
    return this.emit('message', ...args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    this.flags = {};
    // No invented rejection: an unanswered ack remains pending.
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
    return this;
  }
  open(): this {
    return this.connect();
  }
  disconnect(): this {
    return this;
  }
  close(): this {
    return this.disconnect();
  }
}
