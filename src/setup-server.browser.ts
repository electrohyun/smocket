/**
 * The `setup-server` the browser run sees (#105). A browser page cannot host a
 * socket.io server process, so the real target has no counterpart there and the
 * browser project answers a narrower question than the dual run does: whether the
 * mock behaves in a browser the way it behaves in Node.
 *
 * It exists as a module rather than a flag because `setup-server.ts` imports both
 * targets statically, and `setup-real-server.ts` pulls in `node:http` and `node:net`.
 * Those would enter the browser bundle and fail at load even though nothing calls
 * them, so `vitest.browser.config.ts` aliases `setup-server` here and the real
 * target never reaches the graph.
 */
export { setupMockServer as setupServer } from './setup-mock-server';
