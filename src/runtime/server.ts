import type {
  AdapterFactory,
  BroadcastContract,
  ClientSocketContract,
  ConnectOptions,
  DecorateAcknowledgements,
  DecorateAcknowledgementsWithMultipleResponses,
  DefaultEventsMap,
  DefaultSocketData,
  EventNameWithoutAck,
  EventParams,
  EventsMap,
  FetchedSocketContract,
  MessageEventParams,
  NamespaceContract,
  ParentNspNameMatchFn,
  ReservedOrUserEventName,
  ReservedOrUserListener,
  ServerContract,
  ServerReservedEvents,
  ServerSocketContract,
  SmocketAdapter,
  SmocketServer,
  SupportedServerListenerEvents,
  TimeoutBroadcastContract,
  ConnectionMiddleware,
} from '../contract';
import { defer, resolveAuth, serverClosedError } from './delivery';
import { NodeEmitter, type Listener, type OrdinaryEventName } from './emitters';
import { Manager } from './manager';
import { Namespace, ParentNamespace, type Waiter } from './namespaces';
import { ClientSocket, FailedClientSocket, ServerSocket } from './sockets';

/** Module-wide normalized-origin registry shared by `Server` and `connect` (0003). */
const servers = new Map<string, Server>();

function normalizeNamespace(name: string): string {
  if (name === '' || name === '/') return '/';
  return name.startsWith('/') ? name : `/${name}`;
}

/**
 * Normalize registry origins like socket.io-client: resolve relative URLs against
 * `location.origin` and supply the scheme's default port (0003).
 */
function parseUrl(url: string): {
  origin: string;
  namespace: string;
  query: Record<string, string>;
} {
  // `location` is a browser-only host boundary.
  const base = (globalThis as { location?: { origin: string } }).location?.origin;
  const parsed = new URL(url, base);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const origin = `${parsed.protocol}//${parsed.hostname}:${port}`;
  const query: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) query[key] = value;
  return { origin, namespace: parsed.pathname, query };
}

/**
 * Resolve the origin registry and namespace path (0003), returning an asynchronous
 * `connect_error` when no server exists (0005). URL query parameters replace, rather
 * than merge with, `options.query`, matching measured socket.io-client 4.x behavior
 * (0006).
 */
export function connect(url: string, options?: ConnectOptions): ClientSocketContract {
  const { origin, namespace, query: urlQuery } = parseUrl(url);
  const server = servers.get(origin);
  if (!server) return new FailedClientSocket(origin, options?.auth ?? {});
  const query = Object.keys(urlQuery).length > 0 ? urlQuery : options?.query;
  return server.connect(namespace, {
    auth: options?.auth,
    query,
    forceNew: options?.forceNew,
    multiplex: options?.multiplex,
  });
}

/** Test-only reset for the internal module-wide registry. */
export function resetRegistry(): void {
  servers.clear();
}

// `SmocketServer` rather than `ServerContract`, so the wider interface an application
// annotates with is checked against this class rather than trusted to stay in step.
export class Server<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> implements SmocketServer<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
  /** Internal registry key with no socket.io public counterpart. */
  private readonly origin: string;
  /** Stable normalized namespace identities; dynamic admission adds matched children. */
  private readonly namespaces = new Map<string, Namespace>();
  /** Dynamic parents are tried in registration order for unregistered names. */
  private readonly parents: ParentNamespace[] = [];
  /** Manual child attachment uses the latest parent registered for each RegExp object. */
  private readonly regexParents = new Map<RegExp, ParentNamespace>();
  /** `nextConnection(name)` observers waiting for a function-matched child to exist. */
  private readonly dynamicWaiters = new Map<string, Waiter[]>();
  /** The origin's reusable Manager; duplicate namespaces and opt-outs bypass it (0028). */
  private cachedManager: Manager | undefined;

  /** Custom factory applied to every namespace created after registration. */
  private adapterFactory: AdapterFactory | undefined;
  /** Custom instances already assigned to namespaces, used to enforce isolation. */
  private readonly adapterInstances = new Set<SmocketAdapter>();
  /** Adapter registration closes as soon as any connection attempt begins. */
  private admissionStarted = false;
  /** Set before teardown starts, so no namespace created during or after close can accept. */
  private closed = false;
  /** The first close owns teardown; repeated calls return the same completed work. */
  private closePromise: Promise<void> | undefined;

  /** Register this required URL under its normalized origin (0003). */
  constructor(url: string) {
    this.origin = parseUrl(url).origin;
    // Root is the only static namespace admitted without prior `of()` registration.
    this.getNamespace('/', undefined, false);
    servers.set(this.origin, this as Server);
  }

  /**
   * Register smocket's custom routing seam. Factories must return one adapter per
   * namespace; delivery remains in the ordered core (0010). Registration closes at
   * first admission and replacement is atomic (`docs/differences.md` §B).
   */
  adapter(factory: AdapterFactory<ListenEvents, EmitEvents, ServerSideEvents, SocketData>): void {
    if (this.admissionStarted) {
      throw new Error('adapter must be registered before the first connection attempt');
    }
    const runtimeFactory = factory as AdapterFactory;
    const used = new Set(this.adapterInstances);
    const replacements = new Map<Namespace, SmocketAdapter>();
    for (const namespace of this.namespaces.values()) {
      const adapter = runtimeFactory(namespace);
      if (used.has(adapter)) {
        throw new Error('adapter factory must return a fresh instance for each namespace');
      }
      used.add(adapter);
      replacements.set(namespace, adapter);
    }
    for (const [namespace, adapter] of replacements) namespace.useAdapter(adapter);
    this.adapterFactory = runtimeFactory;
    this.adapterInstances.clear();
    for (const adapter of replacements.values()) this.adapterInstances.add(adapter);
  }

  private getNamespace(name: string, parent?: ParentNamespace, emitLifecycle = true): Namespace {
    const normalized = normalizeNamespace(name);
    const existing = this.namespaces.get(normalized);
    if (existing) return existing;
    const attachTo = parent ?? this.matchingRegExpParent(normalized);
    const namespace = new Namespace(normalized, this.origin, this.closed);
    if (this.adapterFactory) {
      const adapter = this.adapterFactory(namespace);
      if (this.adapterInstances.has(adapter)) {
        throw new Error('adapter factory must return a fresh instance for each namespace');
      }
      namespace.useAdapter(adapter);
      this.adapterInstances.add(adapter);
    }
    attachTo?.addChild(namespace);
    this.namespaces.set(normalized, namespace);
    const waiters = this.dynamicWaiters.get(normalized);
    if (waiters) {
      this.dynamicWaiters.delete(normalized);
      for (const waiter of waiters) {
        void namespace.nextConnection().then(waiter.resolve, waiter.reject);
      }
    }
    if (emitLifecycle && normalized !== '/') this.emitNewNamespace(namespace);
    return namespace;
  }

  /** A manual concrete lookup attaches only to a RegExp parent, as Socket.IO does. */
  private matchingRegExpParent(name: string): ParentNamespace | undefined {
    return [...this.regexParents.values()].find((parent) => parent.matchesSynchronously(name));
  }

  private emitNewNamespace(namespace: Namespace): void {
    this.getNamespace('/').emitReserved('new_namespace', namespace);
  }

  of(
    name: string | RegExp | ParentNspNameMatchFn,
    listener?: (
      socket: ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    ) => void,
  ): NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData> {
    if (typeof name !== 'string') {
      const parent = new ParentNamespace(`/_${this.parents.length}`, name);
      this.parents.push(parent);
      if (name instanceof RegExp) this.regexParents.set(name, parent);
      if (listener) parent.on('connection', listener as Listener);
      return parent as NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
    }
    return this.getNamespace(name) as NamespaceContract<
      ListenEvents,
      EmitEvents,
      ServerSideEvents,
      SocketData
    >;
  }

  on<
    Event extends ReservedOrUserEventName<
      ServerReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      SupportedServerListenerEvents<ServerSideEvents>
    >,
  >(
    event: Event,
    listener: ReservedOrUserListener<
      ServerReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      SupportedServerListenerEvents<ServerSideEvents>,
      Event
    >,
  ): this {
    return this.getNamespace('/').on(event, listener as Listener) as unknown as this;
  }

  addListener(event: OrdinaryEventName, listener: Listener): this {
    return this.getNamespace('/').addListener(event, listener) as unknown as this;
  }

  once<
    Event extends ReservedOrUserEventName<
      ServerReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      SupportedServerListenerEvents<ServerSideEvents>
    >,
  >(
    event: Event,
    listener: ReservedOrUserListener<
      ServerReservedEvents<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      SupportedServerListenerEvents<ServerSideEvents>,
      Event
    >,
  ): this {
    return this.getNamespace('/').once(event, listener as Listener) as unknown as this;
  }

  prependListener(event: OrdinaryEventName, listener: Listener): this {
    return this.getNamespace('/').prependListener(event, listener) as unknown as this;
  }

  prependOnceListener(event: OrdinaryEventName, listener: Listener): this {
    return this.getNamespace('/').prependOnceListener(event, listener) as unknown as this;
  }

  removeListener(event: OrdinaryEventName, listener: Listener): this {
    return this.getNamespace('/').removeListener(event, listener) as unknown as this;
  }

  off(event: OrdinaryEventName, listener: Listener): this {
    return this.getNamespace('/').off(event, listener) as unknown as this;
  }

  removeAllListeners(event?: OrdinaryEventName): this {
    return this.getNamespace('/').removeAllListeners(event) as unknown as this;
  }

  listeners = ((event: OrdinaryEventName) =>
    (this.getNamespace('/') as NodeEmitter).listeners(event)) as ServerContract<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >['listeners'];

  rawListeners(event: OrdinaryEventName): Listener[] {
    return this.getNamespace('/').rawListeners(event);
  }

  listenerCount(event: OrdinaryEventName, listener?: Listener): number {
    return this.getNamespace('/').listenerCount(event, listener);
  }

  eventNames(): (string | symbol)[] {
    return this.getNamespace('/').eventNames();
  }

  setMaxListeners(maxListeners: number): this {
    return this.getNamespace('/').setMaxListeners(maxListeners) as unknown as this;
  }

  getMaxListeners(): number {
    return this.getNamespace('/').getMaxListeners();
  }

  use(
    middleware: ConnectionMiddleware<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ): this {
    this.getNamespace('/').use(middleware as ConnectionMiddleware);
    return this;
  }

  /** Admit only registered namespaces; an invalid name creates no namespace or adapter state. */
  connect(
    namespace = '/',
    source?: ConnectOptions,
  ): ClientSocketContract<EmitEvents, ListenEvents> {
    this.admissionStarted = true;
    const normalized = normalizeNamespace(namespace);
    const manager = this.managerFor(normalized, source);
    const registered = this.namespaces.get(normalized);
    if (!registered) {
      const client = new ClientSocket(
        manager,
        undefined,
        source,
        () => this.namespaces.get(normalized),
        (retryingClient) => this.admitDynamic(retryingClient, normalized),
      );
      if (this.parents.length === 0) client.failInvalidNamespace();
      else this.admitDynamic(client, normalized);
      return client as ClientSocketContract<EmitEvents, ListenEvents>;
    }
    return registered.connect(manager, source) as ClientSocketContract<EmitEvents, ListenEvents>;
  }

  /** Resolve auth once, then try dynamic parents in registration order. */
  private admitDynamic(client: ClientSocket, name: string): void {
    const attempt = client.beginConnectionAttempt();
    if (!attempt) return;
    const source = client.connectionSource();
    defer(() => {
      if (!client.isConnectionAttemptPending(attempt)) return;
      resolveAuth(source?.auth, (auth) => {
        if (!client.isConnectionAttemptPending(attempt)) return;
        const tryParent = (index: number): void => {
          const parent = this.parents[index];
          if (!parent) {
            client.rejectConnectionAttempt(attempt, new Error('Invalid namespace'));
            return;
          }
          parent.matches(name, auth, (allowed) => {
            if (!allowed) {
              tryParent(index + 1);
              return;
            }
            let child: Namespace;
            try {
              child = this.getNamespace(name, parent);
            } catch (error) {
              client.rejectConnectionAttempt(
                attempt,
                error instanceof Error ? error : new Error(String(error)),
              );
              return;
            }
            if (!client.isConnectionAttemptPending(attempt)) return;
            client.attachNamespace(child);
            child.continuePair(client, attempt, { ...source, auth });
          });
        };
        tryParent(0);
      });
    });
  }

  /** Apply socket.io-client's supported cached-Manager lookup boundary (0028). */
  private managerFor(namespace: string, source?: ConnectOptions): Manager {
    if (source?.forceNew || source?.multiplex === false) return new Manager(namespace);
    if (!this.cachedManager) {
      this.cachedManager = new Manager(namespace);
      return this.cachedManager;
    }
    if (this.cachedManager.owns(namespace)) return new Manager(namespace);
    this.cachedManager.claim(namespace);
    return this.cachedManager;
  }

  nextConnection(
    namespace = '/',
  ): Promise<ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>> {
    if (this.closed) return Promise.reject(serverClosedError());
    const normalized = normalizeNamespace(namespace);
    const concrete = this.namespaces.get(normalized);
    if (concrete) {
      return concrete.nextConnection() as Promise<
        ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
      >;
    }
    const regexpParent = this.matchingRegExpParent(normalized);
    if (!regexpParent && this.parents.length > 0) {
      return new Promise<ServerSocket>((resolve, reject) => {
        const waiters = this.dynamicWaiters.get(normalized) ?? [];
        waiters.push({ resolve, reject });
        this.dynamicWaiters.set(normalized, waiters);
      }) as Promise<ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>>;
    }
    return this.getNamespace(normalized, regexpParent).nextConnection() as Promise<
      ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>
    >;
  }

  emit<Event extends EventNameWithoutAck<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): boolean {
    return this.getNamespace('/').emit(event, ...args);
  }
  send(...args: MessageEventParams<EmitEvents>): this {
    this.getNamespace('/').send(...args);
    return this;
  }
  write(...args: MessageEventParams<EmitEvents>): this {
    this.getNamespace('/').write(...args);
    return this;
  }
  to(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData> {
    return this.getNamespace('/').to(room) as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  in(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData> {
    return this.getNamespace('/').in(room) as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  except(
    room: string | string[],
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData> {
    return this.getNamespace('/').except(room) as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  timeout(
    ms: number,
  ): TimeoutBroadcastContract<
    DecorateAcknowledgements<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>>,
    SocketData
  > {
    return this.getNamespace('/').timeout(ms) as TimeoutBroadcastContract<
      DecorateAcknowledgements<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>>,
      SocketData
    >;
  }
  compress(
    _compress: boolean,
  ): BroadcastContract<DecorateAcknowledgementsWithMultipleResponses<EmitEvents>, SocketData> {
    return this.getNamespace('/').compress(_compress) as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  get volatile(): BroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
    SocketData
  > {
    return this.getNamespace('/').volatile as BroadcastContract<
      DecorateAcknowledgementsWithMultipleResponses<EmitEvents>,
      SocketData
    >;
  }
  fetchSockets(): Promise<FetchedSocketContract<EmitEvents, SocketData>[]> {
    return this.getNamespace('/').fetchSockets() as Promise<
      FetchedSocketContract<EmitEvents, SocketData>[]
    >;
  }
  socketsJoin(room: string | string[]): void {
    this.getNamespace('/').socketsJoin(room);
  }
  socketsLeave(room: string | string[]): void {
    this.getNamespace('/').socketsLeave(room);
  }
  disconnectSockets(close = false): void {
    this.getNamespace('/').disconnectSockets(close);
  }

  /**
   * Preserve a newer same-origin registry entry during teardown. Already-armed
   * acknowledgement timers remain active, matching socket.io (#193, 0020).
   */
  close(fn?: (err?: Error) => void): Promise<void> {
    const alreadyClosing = this.closed;
    this.closed = true;
    if (servers.get(this.origin) === this) servers.delete(this.origin);
    for (const waiters of this.dynamicWaiters.values()) {
      for (const waiter of waiters) waiter.reject(serverClosedError());
    }
    this.dynamicWaiters.clear();
    this.closePromise ??= Promise.all(
      [...this.namespaces.values()].map((namespace) => namespace.close()),
    ).then(() => undefined);
    if (fn) {
      void this.closePromise.then(() => {
        if (!alreadyClosing) return fn();

        const error = new Error('Server is not running.') as Error & { code: string };
        error.code = 'ERR_SERVER_NOT_RUNNING';
        fn(error);
      });
    }
    return this.closePromise;
  }
}
