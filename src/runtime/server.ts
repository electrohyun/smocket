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
import { resolveAuth, serverClosedError } from './delivery';
import { NodeEmitter, type Listener, type OrdinaryEventName } from './emitters';
import { Manager } from './manager';
import { Namespace, ParentNamespace, type Waiter } from './namespaces';
import { ClientSocket, FailedClientSocket, ServerSocket } from './sockets';

/**
 * The origin registry: normalized origin -> the `Server` listening there. Every
 * `new Server(url)` registers itself here and every `connect(url)` resolves through
 * it, so the required url and this map are the one decision (0003). A module-level
 * singleton, cleared between tests through `resetRegistry`.
 */
const servers = new Map<string, Server>();

/** Socket.IO's static namespace key: root for empty, otherwise add a leading slash if absent. */
function normalizeNamespace(name: string): string {
  if (name === '' || name === '/') return '/';
  return name.startsWith('/') ? name : `/${name}`;
}

/**
 * Split a url into its origin (the registry key), namespace path, and query string,
 * normalizing the way socket.io's `url.js` does so two spellings of one origin
 * collapse to a single key (0003): a relative url resolves against `location.origin`,
 * and a missing port is filled from the scheme (http -> 80, https -> 443). The query
 * is one of the two sources for `handshake.query`, the other being the options argument;
 * `connect` resolves which one wins (the url does, when it carries a query).
 */
function parseUrl(url: string): {
  origin: string;
  namespace: string;
  query: Record<string, string>;
} {
  // `location` exists in a browser/jsdom run and is absent under plain node; read
  // it off `globalThis` so the reference type-checks either way.
  const base = (globalThis as { location?: { origin: string } }).location?.origin;
  const parsed = new URL(url, base);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const origin = `${parsed.protocol}//${parsed.hostname}:${port}`;
  const query: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) query[key] = value;
  return { origin, namespace: parsed.pathname, query };
}

/**
 * Attach a client to the server registered for `url`'s origin: smocket's
 * app-facing entry point, socket.io-client's `io(url, opts)`. The origin is resolved
 * through the registry (0003) and the url's path selects the namespace. `opts` carries
 * `auth` and `query` onto the handshake (0006). When no server is registered for that
 * origin, the returned client fires `connect_error` and does not retry (0005), rather
 * than throwing.
 *
 * `query` has two sources, the url's own query string and `opts.query`, and the url
 * wins: when the url carries a query, `opts.query` is ignored wholesale, and it is
 * consulted only when the url has none. This is not the intuitive "explicit option
 * wins" rule but is what socket.io-client 4.x does, measured against the real client,
 * so a dogfooding app sees the same handshake on either engine.
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

/**
 * Clear the origin registry. Test-only, and deliberately not re-exported from the
 * package index: the registry is a module-level singleton that would otherwise
 * carry servers across a file's tests, so a suite registering servers resets
 * between cases to keep `connect(url)` lookups isolated.
 */
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
  /**
   * This server's normalized origin, its key in the module `servers` registry.
   * Private: it is internal bookkeeping with no counterpart on real socket.io, so
   * it stays off the public surface rather than becoming an undocumented addition.
   */
  private readonly origin: string;
  /**
   * The namespace registry. Every connection, room and broadcast lives on a
   * `Namespace`; the server is the front door that routes to one. `of` is
   * get-or-create and returns the *same* normalized `Namespace` on repeat calls.
   * Admission only reads this registry, so a client cannot create a namespace.
   */
  private readonly namespaces = new Map<string, Namespace>();
  /** Dynamic parents are tried in registration order for unregistered names. */
  private readonly parents: ParentNamespace[] = [];
  /** Manual child attachment uses the latest parent registered for each RegExp object. */
  private readonly regexParents = new Map<RegExp, ParentNamespace>();
  /** `nextConnection(name)` observers waiting for a function-matched child to exist. */
  private readonly dynamicWaiters = new Map<string, Waiter[]>();
  /** The origin's reusable Manager; duplicate namespaces and opt-outs bypass it (0028). */
  private cachedManager: Manager | undefined;

  /**
   * The custom adapter factory registered through `adapter`, applied to every
   * namespace this server creates. Undefined until a caller registers one, in
   * which case each namespace uses the built-in `Adapter`.
   */
  private adapterFactory: AdapterFactory | undefined;
  /** Custom instances already assigned to namespaces, used to enforce isolation. */
  private readonly adapterInstances = new Set<SmocketAdapter>();
  /** Adapter registration closes as soon as any connection attempt begins. */
  private admissionStarted = false;
  /** Set before teardown starts, so no namespace created during or after close can accept. */
  private closed = false;
  /** The first close owns teardown; repeated calls return the same completed work. */
  private closePromise: Promise<void> | undefined;

  /**
   * The url is required, with no argument-less form: socket.io always takes a
   * connection target, so smocket does too rather than invent a rule for what an
   * unlabelled server means (0003). The url is normalized to an origin and the
   * server registers itself under it, so a later `connect(url)` naming the same
   * origin resolves back to this instance.
   */
  constructor(url: string) {
    this.origin = parseUrl(url).origin;
    // Socket.IO constructs the root namespace with the server. It is the one static
    // namespace a client may enter without an earlier public `of()` registration.
    this.getNamespace('/', undefined, false);
    servers.set(this.origin, this as Server);
  }

  /**
   * Register a custom [adapter](../docs/glossary.md#adapter) factory: smocket's
   * public routing seam. During setup the factory builds one fresh adapter per namespace,
   * replacing the built-in routing (which sids a broadcast targets) while delivery stays in
   * the core, so a custom adapter cannot break per-socket order (0010). This is a
   * smocket-only API with no socket.io-compatible counterpart (see
   * `docs/differences.md` §B). Registration closes at the first connection attempt.
   * Existing adapters change only after every replacement is built successfully.
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

  /** Get the runtime namespace by name, creating it on first use. */
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

  /** Register or read a normalized static namespace (socket.io's lazy `of`). */
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

  /**
   * The server's `on` is the default namespace's: `io.on('connection')` is exactly
   * `io.of('/').on('connection')`, socket.io's primary server entry point, so it
   * wires handlers for connections on `/` and never sees another namespace's.
   */
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

  /**
   * The server's `use` is the default namespace's: `io.use(fn)` registers a connection
   * middleware for connections on `/`, exactly `io.of('/').use(fn)`, socket.io's primary
   * place to authenticate a connection. Middleware on another namespace is registered
   * through `io.of(name).use(fn)`.
   */
  use(
    middleware: ConnectionMiddleware<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  ): this {
    this.getNamespace('/').use(middleware as ConnectionMiddleware);
    return this;
  }

  /**
   * Attach a client to an already registered `namespace` (`/` by default); see
   * `Namespace.connect`. `source` carries the caller's `auth` / `query` onto the
   * connection's handshake. An unregistered name reports `Invalid namespace`
   * without creating registry or adapter state.
   */
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

  /** Resolve with the server socket of the next client to connect on `namespace`. */
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

  // The server's own broadcast surface is the default namespace's: `io.emit()` is
  // exactly `io.of('/').emit()`, so "everyone" means everyone on `/` and never
  // reaches another namespace. Each form delegates rather than reimplements.
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
    // `io.timeout(ms)` is the default namespace's: `io.timeout(ms).to(room)` reaches only `/`.
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
    // `io.volatile` is the default namespace's: `io.volatile.to(room)` reaches only `/`.
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
   * Shut down this server, matching socket.io's observable socket lifecycle. The
   * registry deletion is conditional: constructing a newer server for the same
   * origin replaces this one, and closing the old object must not unregister the
   * replacement. Timers already armed by an acknowledgement are deliberately left
   * alone, as real socket.io does (#193, 0020).
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
