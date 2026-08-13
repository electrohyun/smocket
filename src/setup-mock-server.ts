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

  // Disconnect every client the test opened, then close the server, mirroring the
  // real target's teardown. Closing also removes this server from the origin registry;
  // doing it here keeps the test setup from relying on a later construction to replace it.
  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await server.close();
  });

  ctx.nextConnection = (namespace = '/') => server.nextConnection(namespace);

  ctx.connectClient = async (options: ConnectOptions = {}) => {
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

  // Open a connection without awaiting `connect`, mirroring the real target's
  // `openClient`: a connection a middleware rejects fires `connect_error` and never
  // `connect`, so a test drives this and awaits the error rather than the connect.
  ctx.openClient = (options: ConnectOptions = {}) => {
    const { namespace = '/' } = options;
    const client = server.connect(namespace, options);
    clients.push(client);
    return client;
  };

  // Mirrors the real fixture's registration-free path. `Server.connect` must decide
  // admission from the namespaces already registered through `of`, not create one here.
  ctx.openUnregisteredClient = (namespace: string) => {
    const client = server.connect(namespace);
    clients.push(client);
    return client;
  };

  ctx.connectClients = makeConnectClients(ctx);

  return ctx;
}
