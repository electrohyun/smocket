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

/** Modifiers stored on a socket until its next direct emit or broadcast creation. */
interface SocketFlags {
  volatile?: boolean;
  timeout?: number;
}
/** One client-to-namespace pairing from auth resolution through admission. */
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
  /**
   * The namespace this socket lives on. `nsp.adapter` records its membership and
   * `nsp.sockets` turns a broadcast's target sids back into sockets to deliver to;
   * both belong to the namespace, so every operator this socket builds is scoped
   * to its own namespace (#44) and `socket.nsp` reads back the real object. The
   * disconnect cleanup (#45) drops this socket from the same `nsp.adapter`.
   */
  readonly nsp: SocketNamespace;
  /**
   * The connection handshake (0006), built when the pairing completes and read by a
   * `connection` handler as `socket.handshake`. Carries the caller's `auth` / `query`
   * and the fields smocket derives from the connection itself.
   */
  readonly handshake: Handshake;
  /** The first teardown owns the lifecycle; later disconnect paths await the same work. */
  private teardownPromise: Promise<void> | undefined;
  /** False once this server-side socket begins its disconnect lifecycle. */
  private active = true;
  /** Cleared by whole-socket cleanup so a disconnected socket cannot recreate membership. */
  private acceptsRoomJoins = true;
  /** Guards the adapter's whole-socket removal signal across competing teardown paths. */
  private membershipCleaned = false;
  /**
   * The per-socket store (#108): an empty object at creation that middleware writes and a
   * handler reads, to carry what middleware resolved from the handshake. A fresh socket
   * gets a fresh object, so a reconnection (a new socket, 0013) starts empty, which ties
   * `data` to the socket rather than the client identity, matching real socket.io.
   */
  readonly data: Record<string, unknown> = {};
  private peer!: ClientSocket;
  /** Socket.IO modifiers are pending state on the socket, consumed by one operation. */
  private flags: SocketFlags = {};

  constructor(id: string, nsp: SocketNamespace, handshake: Handshake) {
    super();
    this.id = id;
    this.nsp = nsp;
    this.handshake = handshake;
    // Socket.IO installs one noop `error` listener on every fresh server socket.
    // It is ordinary emitter state: public removal can delete it like any other key.
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

  /** Node returns a fresh snapshot and unwraps `once` registrations to their originals. */
  listeners = ((event: OrdinaryEventName) =>
    nodeListeners(
      this.eventListeners,
      event,
    ) as AnyListener[]) as ServerSocketContract['listeners'];

  /** Count every registration, or only direct and original `once` identity matches. */
  listenerCount = ((event: OrdinaryEventName, listener?: Listener) => {
    return nodeListenerCount(this.eventListeners, event, listener);
  }) as ServerSocketContract['listenerCount'];

  rawListeners(event: OrdinaryEventName): Listener[] {
    return nodeRawListeners(this.eventListeners, event);
  }

  /** Node property-key order sorts integer strings before other strings and symbols. */
  eventNames(): (string | symbol)[] {
    return nodeEventNames(this.eventListeners);
  }

  /** Server `once` uses Node's wrapper shape, which `listeners()` unwraps. */
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

  /** Wire the paired client in; called by `Namespace.pair` before completion. */
  attachPeer(client: ClientSocket): void {
    this.peer = client;
  }

  /**
   * Server-side teardown for a disconnecting socket, one tick later through the same
   * `defer` a server-inbound emit uses. A client-to-server emit sent just before disconnect
   * is already queued on that same next tick, so deferring the teardown lets it arrive
   * before the socket leaves its rooms, keeping the per-socket FIFO invariant the marker
   * proofs rely on. (A `DelayingAdapter` only slows the client-inbound stream, never this
   * one, so it does not disturb this ordering. Whole-socket cleanup drains its queued
   * client-inbound deliveries before the socket leaves the namespace roster.)
   *
   * `disconnecting` fires while the rooms are still intact, so a handler can read
   * and notify them; `disconnect` fires once they are gone. Both carry `reason`,
   * the string real socket.io reports on this side (pinned in the tests).
   */
  private teardown(reason: string): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise;
    this.teardownPromise = new Promise((resolve) => {
      defer(() => {
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

  /**
   * Remove every trace a connection middleware could have created before admission.
   * This path deliberately emits no lifecycle event: Socket.IO does not report a server
   * `disconnect` for a socket that never connected. `cleanupMembership` is idempotent,
   * so cancellation and a later middleware callback can both reach it safely.
   */
  cleanupConnectionAttempt(): void {
    this.active = false;
    this.cleanupMembership();
  }

  /** Whole-socket membership cleanup shared by abandoned attempts and disconnect. */
  private cleanupMembership(): void {
    if (this.membershipCleaned) return;
    this.membershipCleaned = true;
    this.acceptsRoomJoins = false;
    for (const room of this.rooms) this.nsp.adapter.del(this.id, room);
    // `del` removes one room and intentionally leaves the sid entry alone. Whole-socket
    // cleanup owns the reverse-index deletion, matching socket.io-adapter's `delAll`
    // without adding that still-undecided method to smocket's public adapter seam (#238).
    this.nsp.adapter.sids.delete(this.id);
    this.nsp.adapter.removeSocket?.(this.id);
    // Empty the live Set in place (contract: "emptied in place on teardown")
    // rather than replacing it, so any held reference sees it clear.
    this.rooms.clear();
    // A pending socket is not registered yet, but deleting is harmless and keeps this
    // primitive complete when it is shared with connected-socket teardown.
    this.nsp.sockets.delete(this.id);
  }

  /**
   * A client-initiated disconnect (`client.disconnect()`) reaching the server
   * side. The client already reported `io client disconnect` on its own side; the
   * server reports `client namespace disconnect`, real socket.io's reason here.
   */
  handleDisconnect(): void {
    void this.teardown('client namespace disconnect');
  }

  /** Server-wide close: transport loss on the client, shutdown lifecycle here. */
  async closeFromServer(): Promise<void> {
    if (this.teardownPromise) return this.teardownPromise;
    await this.teardown('server shutting down');
    if (this.peer.connected) this.peer.markDisconnected('transport close');
  }

  /**
   * Server-initiated disconnect, socket.io's `socket.disconnect(close?)`. With
   * `true`, the logical Manager applies this lifecycle to every connected namespace;
   * otherwise only this socket closes (0028). There is still no transport here.
   */
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
    this.teardownPromise = Promise.resolve();
    this.active = false;
    this.dispatch('disconnecting', [reason]);
    this.connected = false;
    this.cleanupMembership();
    this.dispatch('disconnect', [reason]);
    return true;
  }

  /** Mark admission complete before the server's public connection observers run. */
  markConnected(): void {
    this.connected = true;
  }

  /** Whether Manager-wide teardown may still originate from this server socket. */
  isActive(): boolean {
    return this.active;
  }

  emit(event: string, ...args: unknown[]): boolean {
    assertNotReservedEvent(event);
    const flags = this.consumeFlags();
    const { args: deliveredArgs } = withAckTimeout(args, flags.timeout);
    if (flags.volatile && !this.peer.connected) return true;
    this.emitOutgoing(event, args);
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

  /**
   * Deliver one already-encoded broadcast packet to this socket's client. The
   * outgoing listener intentionally sees the shared live source after encoding,
   * while the client receives its own decode of the frozen packet (0026).
   */
  sendBroadcast(
    event: string,
    sourceArgs: unknown[],
    payload: EncodedPayload,
    ack?: (...answer: unknown[]) => void,
  ): void {
    this.emitOutgoing(event, sourceArgs);
    sendEncoded(this.peer, event, payload, ack);
  }
  /**
   * Arm a timeout flag on this same socket. The next direct emit consumes it, or the next
   * `to` / `broadcast` / `except` transfers it into an ack-collecting operator (#112).
   */
  timeout(ms: number): ServerSocket {
    this.flags.timeout = ms;
    return this;
  }

  /** Compression affects transport packet options upstream; the fluent logic surface remains. */
  compress(_compress: boolean): this {
    return this;
  }

  /** Whether the paired client has completed its connection for volatile delivery. */
  isClientReady(): boolean {
    return this.peer.connected;
  }

  get disconnected(): boolean {
    return !this.connected;
  }

  /**
   * Arm a volatile flag on this same socket (0016). The next direct emit consumes it, or
   * the next broadcast-operator creation transfers it into that operator.
   */
  get volatile(): this {
    this.flags.volatile = true;
    return this;
  }

  get broadcast(): BroadcastContract {
    // Everyone except the sender: no target rooms, except the sender's own id-room.
    return this.newBroadcastOperator([], [this.id]);
  }
  join(room: string | string[]): void {
    if (!this.acceptsRoomJoins) return;
    // `join` takes one room or many; `leave` is always one, matching socket.io.
    // Each room is recorded in the adapter (both directions) and mirrored into
    // this socket's own `rooms`, the server-only view the tests observe.
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
    // The rooms, minus the sender: `socket.to(room)` is `socket.broadcast.to(room)`.
    // If the sender is itself a member of `room`, the room's union includes it and
    // the id-room except then removes it, so the sender is excluded for free.
    return this.newBroadcastOperator(asRooms(room), [this.id]);
  }
  in(room: string | string[]): BroadcastContract {
    return this.to(room);
  }
  except(room: string | string[]): BroadcastContract {
    // Everyone except both the named room's members and the sender: no target
    // rooms, except the given rooms plus the sender's own id-room.
    return this.newBroadcastOperator([], [...asRooms(room), this.id]);
  }

  /** Move pending modifiers into one newly-created operator, then clear the socket. */
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

  /** Snapshot and clear modifiers atomically, giving them a one-operation lifetime. */
  private consumeFlags(): SocketFlags {
    const flags = this.flags;
    this.flags = {};
    return flags;
  }
}

export class ClientSocket extends ClientEmitter implements ClientSocketContract {
  connected = false;
  recovered = false;
  auth: Record<string, unknown> | AuthCallback;
  id: string | undefined;
  /** The shared Manager stand-in; compared only by identity across namespaces. */
  readonly io: Manager;
  /**
   * The namespace this client is attached to. Held so `connect` (a reconnect) can
   * re-pair on the same namespace without routing through the dead server socket.
   */
  private nsp: SocketNamespace | undefined;
  /**
   * The current paired server socket. Assigned at `completeConnection`, not at
   * construction, and not readonly: a reconnect swaps in a new socket with a new
   * id, since the id belongs to one connection, not to the client.
   */
  private serverSocket!: ServerSocket;
  /** The only pairing still allowed to reach `connection` for this client. */
  private connectionAttempt: ConnectionAttempt | undefined;
  /** Emits made before `connect`; flushed in order once connected (like sendBuffer). */
  private sendBuffer: Array<[string, unknown[]]> = [];
  /**
   * Rejecters for acks still waiting for an answer. socket.io-client settles a
   * pending `emitWithAck` with an error when the socket disconnects instead of
   * leaving the promise hanging, so `disconnect` drains these. Only this promise
   * form is tracked: the trailing-callback ack and the server-to-client direction
   * stay silently pending on disconnect (pinned against real socket.io), so they
   * need no registry.
   */
  private readonly pendingAcks = new Set<(reason: Error) => void>();
  /** Socket.IO modifiers are pending state on the socket and consumed by one emit. */
  private flags: SocketFlags = {};
  /**
   * The caller's `auth` / `query`, held so a reconnect (`connect`) can rebuild the
   * same handshake on its fresh server socket, the way socket.io-client resends the
   * connection's auth and query on every reattach.
   */
  private readonly handshakeSource?: ConnectOptions;
  /**
   * Re-read a namespace after `Invalid namespace`. Socket.IO lets the same client
   * connect manually once the server registers that static name.
   */
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

  /** Bind an admitted dynamic client to the one cached concrete child. */
  attachNamespace(namespace: SocketNamespace): void {
    this.nsp = namespace;
  }

  /** Reuse stable lookup options while reading mutable auth at each connection attempt. */
  connectionSource(): ConnectOptions {
    return { ...this.handshakeSource, auth: this.auth };
  }

  /**
   * Server accepted us on `serverSocket`: adopt it and its id, fire `connect`,
   * then flush buffered emits to it. On a reconnect this is a new socket and id,
   * and flushing after the swap sends the buffer (emits made while disconnected)
   * to the new socket, matching socket.io-client.
   */
  completeConnectionAttempt(attempt: ConnectionAttempt, serverSocket: ServerSocket): void {
    if (!this.isConnectionAttemptPending(attempt)) {
      if (attempt.state !== 'connected') serverSocket.cleanupConnectionAttempt();
      return;
    }
    attempt.state = 'connected';
    this.connectionAttempt = undefined;
    this.serverSocket = serverSocket;
    this.connected = true;
    this.recovered = false;
    this.id = serverSocket.id;
    this.io.connected(this);
    const buffered = this.sendBuffer;
    this.sendBuffer = [];
    for (const [event, args] of buffered) {
      // socket.io-client does not observe or encode a buffered packet until the
      // connection flushes it. A listener mutation here therefore reaches the snapshot.
      this.emitOutgoing(event, args);
      send(this.serverSocket, event, args);
    }
    // The buffered packet is observed while the socket is already connected, but before
    // the public connect listener. Its named server listener still runs later through send.
    this.dispatch('connect', []);
  }

  /**
   * Deliveries to this client are what a delay affects (#78): the per-socket delay slows a
   * socket's client-inbound stream, keyed by the client's identity in the namespace, its
   * paired server socket's id. During the connect window the pairing is not complete yet
   * (`serverSocket` is unset), and an emit from a `connection` handler reaches here before
   * then, so that case falls back to the default next-tick with no delay.
   */
  override scheduleReceive(deliver: () => void): void {
    const paired: ServerSocket | undefined = this.serverSocket;
    if (paired) scheduleDelivery(paired.nsp.adapter, paired.id, deliver);
    else defer(deliver);
  }

  /**
   * A connection middleware rejected us: fire `connect_error` a tick later, carrying
   * the middleware's error (its `message`, and its `data` if set) the way real
   * socket.io's client rebuilds it. The connection never completes, so the client
   * stays `connected === false` with no id; unlike a missing-server failure (0005),
   * this is an app-driven rejection, so it is not logged to the console. The deferral
   * matches a successful connect's one-tick delay, so a `connect_error` handler added
   * on the next line is registered in time.
   */
  rejectConnectionAttempt(attempt: ConnectionAttempt, err: MiddlewareError): void {
    if (!this.isConnectionAttemptPending(attempt)) return;
    attempt.state = 'rejected';
    attempt.serverSocket?.cleanupConnectionAttempt();
    this.connectionAttempt = undefined;
    this.io.settlePending(this);
    defer(() => this.dispatch('connect_error', [err]));
  }

  /** Report static namespace admission failure without making the client terminal. */
  failInvalidNamespace(): void {
    defer(() => this.dispatch('connect_error', [new Error('Invalid namespace')]));
  }

  /** Start one pairing, or reject a duplicate `connect()` while one is already pending. */
  beginConnectionAttempt(): ConnectionAttempt | undefined {
    if (this.connected || this.connectionAttempt?.state === 'pending') return undefined;
    const attempt: ConnectionAttempt = { state: 'pending' };
    this.connectionAttempt = attempt;
    this.io.registerPending(this);
    return attempt;
  }

  /** Attach the middleware-visible server socket to the still-current attempt. */
  attachConnectionAttempt(attempt: ConnectionAttempt, serverSocket: ServerSocket): boolean {
    if (!this.isConnectionAttemptPending(attempt) || attempt.serverSocket) return false;
    attempt.serverSocket = serverSocket;
    return true;
  }

  /** Whether a callback still belongs to the one attempt this client may complete. */
  isConnectionAttemptPending(attempt: ConnectionAttempt): boolean {
    return this.connectionAttempt === attempt && attempt.state === 'pending';
  }

  /** Whether `socket` is this client's current or connection-handler-visible pairing. */
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

  /** Called by the Manager when its shared transport identity is closed. */
  cancelConnectionAttemptFromManager(): void {
    this.cancelConnectionAttempt();
  }

  emit(event: string, ...args: unknown[]): this {
    this.sendEvent(event, args);
    return this;
  }
  send(...args: unknown[]): this {
    return this.emit('message', ...args);
  }

  /** Send one event and expose timeout cancellation to `emitWithAck` only. */
  private sendEvent(event: string, args: unknown[]): ((reason: Error) => void) | undefined {
    assertNotReservedEvent(event);
    const flags = this.consumeFlags();
    const timed = withAckTimeout(args, flags.timeout);
    if (flags.volatile && !this.connected) return timed.cancel;
    // Before the connection completes, emits are buffered rather than lost, and
    // outgoing observation and encoding both wait for `completeConnection` (0026).
    if (!this.connected) {
      this.sendBuffer.push([event, timed.args]);
      return timed.cancel;
    }
    this.emitOutgoing(event, args);
    send(this.serverSocket, event, timed.args);
    return timed.cancel;
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    // Like the free `emitWithAck`, but the rejecter is registered so `disconnect`
    // can settle a still-pending ack, matching socket.io-client.
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

  /** Arm a timeout flag on this same client for consumption by its next emit. */
  timeout(ms: number): ClientSocket {
    this.flags.timeout = ms;
    return this;
  }

  /** Compression affects transport packet options upstream; the fluent logic surface remains. */
  compress(_compress: boolean): this {
    return this;
  }

  /**
   * The volatile emitter (0016). Unlike a normal emit, a volatile one is not buffered while
   * disconnected: sent before the connection completes it is dropped, and once connected it is
   * an ordinary emit. `this.connected` / `this.serverSocket` are read at emit time, not now.
   */
  get volatile(): this {
    this.flags.volatile = true;
    return this;
  }

  /** Snapshot and clear modifiers atomically, giving them a one-operation lifetime. */
  private consumeFlags(): SocketFlags {
    const flags = this.flags;
    this.flags = {};
    return flags;
  }

  connect(): this {
    // Already-connected `connect()` is a no-op in socket.io. Otherwise re-pair on
    // our namespace: a brand-new server socket and id, none of the old rooms, and the
    // same handshake source, so the reattached socket carries the original auth/query.
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
    // Client-initiated: this side reports `io client disconnect`, then the server
    // side tears down and reports `client namespace disconnect`.
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

  /**
   * Flip to disconnected, settle any pending ack, and fire the client-side
   * `disconnect` with `reason`. Shared by a client-initiated disconnect and a
   * server-initiated one (`ServerSocket.disconnect`); only the reason differs.
   * socket.io-client settles a pending emitWithAck on disconnect instead of
   * leaving it hanging, which is why the rejecters are drained here.
   * Callers first verify this client is connected.
   */
  markDisconnected(reason: string): void {
    this.connected = false;
    this.id = undefined;
    this.io.disconnected(this);
    const rejecters = [...this.pendingAcks];
    this.pendingAcks.clear();
    for (const reject of rejecters) reject(new Error('socket has been disconnected'));
    this.dispatch('disconnect', [reason]);
  }

  /** Called by the Manager while applying connection-wide server teardown. */
  disconnectFromServer(): void {
    if (this.connected) this.serverSocket.disconnectNamespaceFromServer();
  }
}

/**
 * The client `connect(url)` returns when no server is registered for the origin.
 * It never pairs: one tick later it fires `connect_error` once and logs the
 * failure to the console, then stops. This is smocket's single deliberate
 * divergence from real socket.io, which retries the connection forever (0005) —
 * that retry is driven by network timing a mock has no source for, so smocket
 * reports the failure and does not simulate it. The `console.error` is a
 * diagnostics layer over the event, so a mistyped url is not silent for the common
 * case of no `connect_error` handler.
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
    // Next tick through the same `defer` a successful connect uses (0005: no
    // artificial delay), so a `connect_error` handler added on the next line is
    // registered in time, the same ordering reason as a real connect (0004).
    defer(() => {
      console.error(`[smocket] connect_error: ${message}`);
      this.dispatch('connect_error', [new Error(message)]);
    });
  }

  // A failed connection never completes, so there is nothing to send, ack, or tear
  // down, and `connect()` does not retry: the failure was already reported (0005).
  emit(event: string, ..._args: unknown[]): this {
    assertNotReservedEvent(event);
    this.flags = {};
    /* inert: never connected */
    return this;
  }
  send(...args: unknown[]): this {
    return this.emit('message', ...args);
  }
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    this.flags = {};
    // No server will ever answer, so this stays pending, matching a client whose
    // connection never completes rather than inventing a rejection shape.
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
    /* inert: the failure is terminal, no retry (0005) */
    return this;
  }
  open(): this {
    return this.connect();
  }
  disconnect(): this {
    /* inert: never connected */
    return this;
  }
  close(): this {
    return this.disconnect();
  }
}
