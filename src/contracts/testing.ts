import type { DefaultEventsMap, DefaultSocketData, EventsMap } from './events';
import type {
  ClientSocketContract,
  ConnectOptions,
  ServerContract,
  ServerSocketContract,
} from './api';

export interface ConnectedClient<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  client: ClientSocketContract<EmitEvents, ListenEvents>;
  serverSocket: ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
}

/**
 * The shape both `setupRealServer` and `setupMockServer` return. Selecting the
 * target is a one-import swap in the test files; nothing else changes.
 */
export interface ServerContext<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> {
  io: ServerContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  /** Connect one more client and return it paired with its server-side socket. */
  connectClient: (
    options?: ConnectOptions,
  ) => Promise<ConnectedClient<ListenEvents, EmitEvents, ServerSideEvents, SocketData>>;
  /**
   * Open a connection and return the client immediately, without waiting for it to
   * connect. Needed for a connection expected to fail (a middleware rejection): its
   * `connect` never fires, so `connectClient` would hang, whereas a test drives this
   * and awaits the client's `connect_error` instead.
   */
  openClient: (options?: ConnectOptions) => ClientSocketContract<EmitEvents, ListenEvents>;
  /**
   * Open a client on a namespace without observing `nextConnection` first. The real
   * fixture keeps this separate because `ioServer.of(namespace)` would register the
   * namespace and invalidate an unregistered-admission test before the client starts.
   */
  openUnregisteredClient: (namespace: string) => ClientSocketContract<EmitEvents, ListenEvents>;
  /**
   * Connect `count` clients and return them paired with their server-side
   * sockets, in connection order. Sugar over `connectClient` for the recurring
   * multi-client setup; connections are made one at a time, since the fixture
   * pairs each connect with the next `connection`, so connecting concurrently
   * would mismatch the pairs.
   */
  connectClients: (
    count: number,
    options?: ConnectOptions,
  ) => Promise<ConnectedClient<ListenEvents, EmitEvents, ServerSideEvents, SocketData>[]>;
  /**
   * Resolve with the server-side socket of the next client to connect on
   * `namespace`. Needed when the connection is not started by `connectClient`,
   * as with a reconnect of a client already known to the test.
   */
  nextConnection: (
    namespace?: string,
  ) => Promise<ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>>;
}
