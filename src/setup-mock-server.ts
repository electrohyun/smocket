import { afterEach, beforeEach } from 'vitest';
import type { ClientSocketContract, FixtureConnectOptions, ServerContext } from './contract';
import { makeConnectClients } from './connect-clients';
import { Server } from './mock-server';

/** Build the `mock` half of the shared dual-run `ServerContext`. */
export function setupMockServer(): ServerContext {
  const ctx = {} as ServerContext;
  let server: Server;
  let clients: ClientSocketContract[] = [];

  beforeEach(() => {
    server = new Server('http://localhost');
    clients = [];
    ctx.io = server;
  });

  // Closing removes the server from the origin registry, keeping tests isolated.
  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await server.close();
  });

  ctx.nextConnection = (namespace = '/') => server.nextConnection(namespace);

  ctx.connectClient = async (options: FixtureConnectOptions = {}) => {
    const { namespace = '/' } = options;
    // Observing the namespace first intentionally registers it, matching the real
    // helper's `ioServer.of(namespace)`. The separate unregistered fixture below
    // skips this step so admission tests cannot register their own subject.
    const pendingConnection = ctx.nextConnection(namespace);
    const client = server.connect(namespace, options);
    const serverSocket = await pendingConnection;
    clients.push(client);
    return { client, serverSocket };
  };

  // A rejected middleware connection emits `connect_error`, never `connect`.
  ctx.openClient = (options: FixtureConnectOptions = {}) => {
    const { namespace = '/' } = options;
    const client = server.connect(namespace, options);
    clients.push(client);
    return client;
  };

  // Keep this path registration-free so admission tests own namespace creation.
  ctx.openUnregisteredClient = (namespace: string) => {
    const client = server.connect(namespace);
    clients.push(client);
    return client;
  };

  ctx.connectClients = makeConnectClients(ctx);

  return ctx;
}
