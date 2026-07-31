import { afterEach, beforeEach } from 'vitest';
import type { ClientSocketContract, ConnectOptions, ServerContext } from './contract';
import { makeConnectClients } from './connect-clients';
import { Server } from './mock-server';

/**
 * The `mock` target: the same `ServerContext` the tests are written against, but
 * backed by smocket instead of a real socket.io server, with no HTTP server and
 * no port (decision ③). Which behaviour it must reproduce is defined by the
 * conformance suite that runs against both targets; whether it does is the CI
 * run's verdict, not this comment's.
 */
export function setupMockServer(): ServerContext {
  const ctx = {} as ServerContext;
  let server: Server;
  let clients: ClientSocketContract[] = [];

  beforeEach(() => {
    server = new Server('http://localhost');
    clients = [];
    ctx.io = server;
  });

  // Disconnect every client the test opened, mirroring the real target's
  // teardown. The in-memory server holds no port or socket and a fresh one
  // replaces it each test, so no current test needs this. Its value is symmetry:
  // the two targets' teardown shape stays identical, so a future test that
  // depends on teardown cannot pass on one target and fail on the other.
  afterEach(() => {
    for (const client of clients) client.disconnect();
  });

  ctx.nextConnection = (namespace = '/') => server.nextConnection(namespace);

  ctx.connectClient = async ({ namespace = '/' }: ConnectOptions = {}) => {
    // `connect` creates the paired server socket synchronously and offers it to
    // `nextConnection`, so the socket awaited here is the one this connect made,
    // not a fresh connection that would never come. See Server.connect.
    const client = server.connect(namespace);
    const serverSocket = await ctx.nextConnection(namespace);
    clients.push(client);
    return { client, serverSocket };
  };

  ctx.connectClients = makeConnectClients(ctx);

  return ctx;
}
