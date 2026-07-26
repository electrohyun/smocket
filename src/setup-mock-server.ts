import { beforeEach } from 'vitest';
import type { ConnectOptions, ServerContext } from './contract';
import { Server } from './mock-server';

/**
 * The `mock` target: same `ServerContext` the tests are written against, but
 * backed by smocket instead of a real socket.io server, with no HTTP server and
 * no port (decision ③). The connect / disconnect lifecycle and id pairing are
 * live (#40); features downstream of a connection still throw a legible "not
 * implemented" from the core, one message per unfinished feature, so a
 * `SMOCKET_TARGET=mock` run is green where a feature has landed and legibly red
 * where it has not.
 */
export function setupMockServer(): ServerContext {
  const ctx = {} as ServerContext;
  let server: Server;

  beforeEach(() => {
    server = new Server();
    ctx.io = server;
  });

  // No teardown needed yet: the in-memory server holds no port or socket, and a
  // fresh `MockServer` per test drops the previous one. Membership cleanup on
  // disconnect is #45, exercised through `client.disconnect()`, not here.

  ctx.nextConnection = (namespace = '/') => server.nextConnection(namespace);

  ctx.connectClient = async ({ namespace = '/' }: ConnectOptions = {}) => {
    // `connect` creates the paired server socket synchronously and offers it to
    // `nextConnection`, so the socket awaited here is the one this connect made,
    // not a fresh connection that would never come. See Server.connect.
    const client = server.connect(namespace);
    const serverSocket = await ctx.nextConnection(namespace);
    return { client, serverSocket };
  };

  return ctx;
}
