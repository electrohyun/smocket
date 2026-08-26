import type { Server, Socket as IoServerSocket } from 'socket.io';
import type { Socket as IoClientSocket } from 'socket.io-client';
import type {
  AdapterContract,
  BroadcastContract,
  ClientSocketContract,
  MiddlewareError,
  NamespaceContract,
  ParentNspNameMatchFn,
  ServerContract,
  ServerSocketContract,
} from './api';
import type {
  DecorateAcknowledgements,
  DecorateAcknowledgementsWithMultipleResponses,
  DefaultEventsMap,
  DefaultSocketData,
  EventName,
  EventParams,
  EventsMap,
  MessageEventParams,
  SocketMiddleware,
} from './events';

/**
 * Compiles only when `Actual` is assignable to `Contract`. This is the (c)
 * safeguard: if a contract above names a member socket.io lacks, or gets its
 * shape wrong (e.g. `rooms: Map` when it is really a `Set`), the matching line
 * below stops compiling.
 *
 * It is one-directional by design: it proves "everything we require exists on
 * socket.io", not "we required everything socket.io offers". A real member we
 * forgot is the tests' job to surface, not this file's.
 */
type Ensure<Contract, Actual extends Contract> = Actual;

// Socket.IO's listener declarations use an internal conditional fallback that
// TypeScript cannot compare structurally with an equivalent public contract once
// event maps are still generic. Keep listener inference covered by the consumer
// typecheck file, and keep the structural proof for every other member here.
type NamespaceParityContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = Omit<
  NamespaceContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  | 'addListener'
  | 'eventNames'
  | 'getMaxListeners'
  | 'listenerCount'
  | 'listeners'
  | 'off'
  | 'on'
  | 'once'
  | 'prependListener'
  | 'prependOnceListener'
  | 'rawListeners'
  | 'removeAllListeners'
  | 'removeListener'
  | 'send'
  | 'setMaxListeners'
  | 'use'
  | 'write'
> & {
  send(
    ...args: MessageEventParams<EmitEvents>
  ): NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  write(
    ...args: MessageEventParams<EmitEvents>
  ): NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  use(
    middleware: (
      socket: ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      next: (error?: MiddlewareError) => void,
    ) => void,
  ): NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
};

type ServerParityContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = Omit<
  ServerContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  | 'addListener'
  | 'eventNames'
  | 'getMaxListeners'
  | 'listenerCount'
  | 'listeners'
  | 'off'
  | 'of'
  | 'on'
  | 'once'
  | 'prependListener'
  | 'prependOnceListener'
  | 'rawListeners'
  | 'removeAllListeners'
  | 'removeListener'
  | 'send'
  | 'setMaxListeners'
  | 'use'
  | 'write'
> & {
  send(
    ...args: MessageEventParams<EmitEvents>
  ): ServerParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  write(
    ...args: MessageEventParams<EmitEvents>
  ): ServerParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  of(
    matcher: string | RegExp | ParentNspNameMatchFn,
    listener?: (
      socket: ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
    ) => void,
  ): NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  use(
    middleware: (
      socket: ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
      next: (error?: MiddlewareError) => void,
    ) => void,
  ): ServerParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
};

type ServerSocketParityContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = Pick<
  ServerSocketContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  | 'broadcast'
  | 'connected'
  | 'data'
  | 'disconnected'
  | 'emit'
  | 'emitWithAck'
  | 'except'
  | 'handshake'
  | 'id'
  | 'in'
  | 'join'
  | 'leave'
  | 'listeners'
  | 'listenerCount'
  | 'eventNames'
  | 'rooms'
  | 'recovered'
  | 'to'
> & {
  readonly volatile: ServerSocketParityContract<
    ListenEvents,
    EmitEvents,
    ServerSideEvents,
    SocketData
  >;
  timeout(
    ms: number,
  ): ServerSocketParityContract<
    ListenEvents,
    DecorateAcknowledgements<EmitEvents>,
    ServerSideEvents,
    SocketData
  >;
  disconnect(
    close?: boolean,
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  send(
    ...args: MessageEventParams<EmitEvents>
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  write(
    ...args: MessageEventParams<EmitEvents>
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  compress(
    compress: boolean,
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  use(
    middleware: SocketMiddleware,
  ): ServerSocketParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
  nsp: NamespaceParityContract<ListenEvents, EmitEvents, ServerSideEvents, SocketData>;
};

type ClientSocketParityContract<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
> = Pick<
  ClientSocketContract<ListenEvents, EmitEvents>,
  | 'auth'
  | 'connected'
  | 'disconnected'
  | 'emitWithAck'
  | 'hasListeners'
  | 'id'
  | 'io'
  | 'listeners'
  | 'recovered'
> & {
  readonly volatile: ClientSocketParityContract<ListenEvents, EmitEvents>;
  timeout(
    ms: number,
  ): ClientSocketParityContract<ListenEvents, DecorateAcknowledgements<EmitEvents>>;
  connect(): ClientSocketParityContract<ListenEvents, EmitEvents>;
  open(): ClientSocketParityContract<ListenEvents, EmitEvents>;
  disconnect(): ClientSocketParityContract<ListenEvents, EmitEvents>;
  close(): ClientSocketParityContract<ListenEvents, EmitEvents>;
  compress(compress: boolean): ClientSocketParityContract<ListenEvents, EmitEvents>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send(...args: any[]): ClientSocketParityContract<ListenEvents, EmitEvents>;
  emit<Event extends EventName<EmitEvents>>(
    event: Event,
    ...args: EventParams<EmitEvents, Event>
  ): ClientSocketParityContract<ListenEvents, EmitEvents>;
};

// Socket.io reference types, derived by indexing so no generic arguments (and no
// `any`) are written by hand.
type IoNamespace<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = DefaultSocketData,
> = ReturnType<Server<ListenEvents, EmitEvents, ServerSideEvents, SocketData>['of']>;
type IoBroadcast = ReturnType<Server['to']>;
type IoAdapter = IoNamespace['adapter'];

// Exported only so `noUnusedLocals` treats them as used (an unused local type
// alias is TS6196); they are compile-time guards, not meant to be imported.
export type AssertServerContract = Ensure<ServerParityContract, Server>;
export type AssertServerSocketContract = Ensure<ServerSocketParityContract, IoServerSocket>;
export type AssertClientSocketContract = Ensure<ClientSocketParityContract, IoClientSocket>;
export type AssertNamespaceContract = Ensure<NamespaceParityContract, IoNamespace>;
export type AssertBroadcastContract = Ensure<BroadcastContract, IoBroadcast>;
export type AssertAdapterContract = Ensure<AdapterContract, IoAdapter>;

interface AssertClientToServerEvents {
  request: (value: string, ack: (accepted: boolean) => void) => void;
}

interface AssertServerToClientEvents {
  notice: (value: string) => void;
  question: (value: string, ack: (answer: number) => void) => void;
}

interface AssertServerSideEvents {
  health: () => void;
}

interface AssertSocketData {
  userId: string;
}

type ConcreteIoServer = Server<
  AssertClientToServerEvents,
  AssertServerToClientEvents,
  AssertServerSideEvents,
  AssertSocketData
>;
type ConcreteIoNamespace = ReturnType<ConcreteIoServer['of']>;
type ConcreteIoBroadcast = ReturnType<ConcreteIoServer['to']>;

export type AssertConcreteServerContract = Ensure<
  ServerParityContract<
    AssertClientToServerEvents,
    AssertServerToClientEvents,
    AssertServerSideEvents,
    AssertSocketData
  >,
  ConcreteIoServer
>;
export type AssertConcreteServerSocketContract = Ensure<
  ServerSocketParityContract<
    AssertClientToServerEvents,
    AssertServerToClientEvents,
    AssertServerSideEvents,
    AssertSocketData
  >,
  IoServerSocket<
    AssertClientToServerEvents,
    AssertServerToClientEvents,
    AssertServerSideEvents,
    AssertSocketData
  >
>;
export type AssertConcreteClientSocketContract = Ensure<
  ClientSocketParityContract<AssertServerToClientEvents, AssertClientToServerEvents>,
  IoClientSocket<AssertServerToClientEvents, AssertClientToServerEvents>
>;
export type AssertConcreteNamespaceContract = Ensure<
  NamespaceParityContract<
    AssertClientToServerEvents,
    AssertServerToClientEvents,
    AssertServerSideEvents,
    AssertSocketData
  >,
  ConcreteIoNamespace
>;
export type AssertConcreteBroadcastContract = Ensure<
  BroadcastContract<
    DecorateAcknowledgementsWithMultipleResponses<AssertServerToClientEvents>,
    AssertSocketData
  >,
  ConcreteIoBroadcast
>;
