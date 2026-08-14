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
// The contract types are exported under their own names, so an app that swapped
// socket.io-client for smocket still has something to annotate with: the value side
// of the substitution already resolved, and only the type side was missing. The five
// entry points (`ServerContract`, `ServerSocketContract`, `ClientSocketContract`,
// `NamespaceContract`, `Handshake`) reach the rest through their own members, so
// those are exported too rather than left reachable but unnameable. `Socket` is the
// server-side alias fixed by 0022, matching the root `socket.io` package while the
// separate client facade owns the client-side name. `ConnectedClient` and `ServerContext`
// are deliberately absent: they are the dual-run test setup's shape, not an app-facing
// surface.
//
// `SmocketServer` is the one name here that is not a socket.io subset. `ServerContract`
// stops where socket.io stops, so annotating with it drops `adapter`, `connect`, and
// `nextConnection`, the server members `differences.md` section B documents as smocket's
// own. That type
// carries them; it is what a `new Server(url)` should be written down as.
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
