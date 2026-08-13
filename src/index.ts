// `io` supports substituting `smocket` for `socket.io-client` without changing app code.
// A default export waits on the CJS interop it needs across tsup's dual output.
export { Adapter, connect, connect as io, DelayingAdapter, Server } from './mock-server';
// `SmocketServer` includes the smocket-only `adapter` and `nextConnection` members;
// `ServerContract` intentionally remains the Socket.IO subset (docs/differences.md §B).
export type {
  AdapterContract,
  AdapterFactory,
  AuthCallback,
  BroadcastContract,
  ClientSocketContract,
  ConnectionMiddleware,
  ConnectOptions,
  DeliveryTimer,
  DefaultEventsMap,
  Handshake,
  MiddlewareError,
  NamespaceContract,
  ParentNspNameMatchFn,
  ServerContract,
  ServerSocketContract,
  SmocketAdapter,
  SmocketServer,
  SocketTimeoutContract,
  TimeoutBroadcastContract,
  TimeoutEmitterContract,
  VolatileClientSocket,
  VolatileServerSocket,
} from './contract';
