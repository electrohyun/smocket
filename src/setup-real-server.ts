import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket as ServerSocket } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach } from 'vitest';
import type { ConnectOptions, ServerContext, ServerContract } from './contract';
import { makeConnectClients } from './connect-clients';

/**
 * Boots a real socket.io server around each test and hands back a
 * `connectClient()` factory. Room / broadcast rules only show up with more than
 * one client (a member vs a non-member), so clients are connected on demand
 * rather than fixed at one. Every connected client is disconnected in
 * `afterEach`. Returns the shared `ServerContext`, so `SMOCKET_TARGET` can swap
 * this for the smocket target without the test files noticing.
 */
export function setupRealServer(): ServerContext {
  const ctx = {} as ServerContext;
  let httpServer: HttpServer;
  let ioServer: Server;
  let port: number;
  let clients: ClientSocket[] = [];

  const namespacePath = (namespace: string): string => {
    if (namespace === '' || namespace === '/') return '/';
    return namespace.startsWith('/') ? namespace : `/${namespace}`;
  };

  beforeEach(async () => {
    httpServer = createServer();
    ioServer = new Server(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    clients = [];
    // Socket.IO's internal listener fallback cannot be compared structurally with
    // the equivalent public generic contract. Only listener registration members
    // are omitted from the parity projections in contract.ts; consumer typechecks
    // cover their inference on both shapes.
    ctx.io = ioServer as unknown as ServerContract;
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => {
      ioServer.close(() => resolve());
    });
  });

  // Going through of() rather than ioServer.once('connection') also creates the
  // namespace, which a client cannot attach to until the server knows it.
  ctx.nextConnection = (namespace = '/') =>
    new Promise<ServerSocket>((resolve) => {
      ioServer.of(namespace).once('connection', (socket) => resolve(socket));
    });

  ctx.connectClient = async ({
    namespace = '/',
    auth,
    query,
    forceNew,
    multiplex,
  }: ConnectOptions = {}) => {
    // Register before opening the client. This ordering is the fixture's static-
    // namespace contract; the dedicated unregistered path below deliberately skips it.
    const serverConnection = ctx.nextConnection(namespace);
    const client = io(`http://localhost:${port}${namespacePath(namespace)}`, {
      transports: ['websocket'],
      auth,
      query,
      forceNew,
      multiplex,
    });

    // Connects are awaited one at a time, so the pending `connection` event
    // belongs to exactly this client, with no id matching needed.
    const [serverSocket] = await Promise.all([
      serverConnection,
      new Promise<void>((resolve) => client.once('connect', () => resolve())),
    ]);

    clients.push(client);
    return { client, serverSocket };
  };

  // Open a connection without awaiting `connect`, for a connection a test expects to
  // fail: a middleware rejection fires `connect_error` and never `connect`, so awaiting
  // the connect here would hang. The client is tracked for teardown like any other.
  ctx.openClient = ({ namespace = '/', auth, query, forceNew, multiplex }: ConnectOptions = {}) => {
    const client = io(`http://localhost:${port}${namespacePath(namespace)}`, {
      transports: ['websocket'],
      auth,
      query,
      forceNew,
      multiplex,
    });
    clients.push(client);
    return client;
  };

  // Deliberately does not call `ioServer.of(namespace)` or `ctx.nextConnection`:
  // either would register the namespace and turn the rejection fixture into an
  // admission fixture before the client sends its namespace connect packet.
  ctx.openUnregisteredClient = (namespace: string) => {
    const client = io(`http://localhost:${port}${namespacePath(namespace)}`, {
      transports: ['websocket'],
    });
    clients.push(client);
    return client;
  };

  ctx.connectClients = makeConnectClients(ctx);

  return ctx;
}
