// `io` is `connect` under socket.io-client's dominant name. It exists for the
// substitution path: an app swaps `socket.io-client` for `smocket` in tests (via
// `resolve.alias` / `vi.mock`) without touching its own code, and most app code
// imports `io`, not `connect`. Examples here stay on `connect` (the server is
// `const io = new Server(...)`), so the two names never collide in one file.
// Only the named export is provided; a default export (`import io from ...`) waits
// on the CJS interop it needs across tsup's dual output.
export {
  Adapter,
  connect,
  connect as io,
  DelayingAdapter,
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
  Handshake,
  MiddlewareError,
  NamespaceContract,
  ParentNspNameMatchFn,
  ServerContract,
  ServerSocketContract,
  ServerSocketContract as Socket,
  SmocketAdapter,
  SmocketServer,
  SocketTimeoutContract,
  TimeoutBroadcastContract,
  TimeoutEmitterContract,
  VolatileClientSocket,
  VolatileServerSocket,
} from './contract';
