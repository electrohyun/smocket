// `io` is `connect` under socket.io-client's dominant name. It exists for the
// substitution path: an app swaps `socket.io-client` for `smocket` in tests (via
// `resolve.alias` / `vi.mock`) without touching its own code, and most app code
// imports `io`, not `connect`. Examples here stay on `connect` (the server is
// `const io = new Server(...)`), so the two names never collide in one file.
// Only the named export is provided; a default export (`import io from ...`) waits
// on the CJS interop it needs across tsup's dual output.
export { Adapter, connect, connect as io, DelayingAdapter, Server } from './mock-server';
// The contract types are exported under their own names, so an app that swapped
// socket.io-client for smocket still has something to annotate with: the value side
// of the substitution already resolved, and only the type side was missing. The five
// entry points (`ServerContract`, `ServerSocketContract`, `ClientSocketContract`,
// `NamespaceContract`, `Handshake`) reach the rest through their own members, so
// those are exported too rather than left reachable but unnameable. `ConnectedClient`
// and `ServerContext` are deliberately absent: they are the dual-run test setup's
// shape, not an app-facing surface. Whether any of these is also aliased to
// socket.io's own `Socket` name is a separate question (#178), since one package
// cannot give that name to both the server and the client socket.
//
// `SmocketServer` is the one name here that is not a socket.io subset. `ServerContract`
// stops where socket.io stops, so annotating with it drops `adapter` and `nextConnection`,
// the two server members `differences.md` section B documents as smocket's own. That type
// carries them; it is what a `new Server(url)` should be written down as.
export type {
  AdapterContract,
  AdapterFactory,
  AuthCallback,
  BroadcastContract,
  ClientSocketContract,
  ConnectionMiddleware,
  ConnectOptions,
  DeliveryTimer,
  Handshake,
  MiddlewareError,
  NamespaceContract,
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
