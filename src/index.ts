// `io` is `connect` under socket.io-client's dominant name. It exists for the
// substitution path: an app swaps `socket.io-client` for `smocket` in tests (via
// `resolve.alias` / `vi.mock`) without touching its own code, and most app code
// imports `io`, not `connect`. Examples here stay on `connect` (the server is
// `const io = new Server(...)`), so the two names never collide in one file.
// Only the named export is provided; a default export (`import io from ...`) waits
// on the CJS interop it needs across tsup's dual output.
export { Adapter, connect, connect as io, Server } from './mock-server';
export type { AdapterFactory, SmocketAdapter } from './contract';
