// `io` is `connect` under socket.io-client's dominant name. It remains for existing
// named-import aliases to the root package. Examples here stay on `connect` because
// the server is conventionally `const io = new Server(...)`, so the names never collide.
// ADR 0023 assigns default imports, callable CommonJS, and the client-side `Socket`
// name to the separate `smocket-client` facade.
export {
  Adapter,
  connect,
  connect as io,
  DelayingAdapter,
  DroppingAdapter,
  Server,
  TracingAdapter,
} from './mock-server';
// Root `Socket` is the server type (0022); the client facade owns its client-side names.
// `SmocketServer` adds the smocket-only members documented in `differences.md` section B.
// Test-fixture-only contracts stay internal.
export type {
  AdapterContract,
  AdapterFactory,
  AuthCallback,
  BroadcastContract,
  BroadcastTrace,
  ClientSocketContract,
  ConnectionMiddleware,
  ConnectOptions,
  DeliveryTimer,
  DefaultEventsMap,
  Event,
  FetchedSocketContract,
  Handshake,
  MiddlewareError,
  NamespaceContract,
  ParentNspNameMatchFn,
  ServerContract,
  ServerSocketContract,
  ServerSocketContract as Socket,
  SmocketAdapter,
  SmocketServer,
  SocketMiddleware,
  SocketTimeoutContract,
  TimeoutBroadcastContract,
  TimeoutEmitterContract,
  VolatileClientSocket,
  VolatileServerSocket,
} from './contract';
