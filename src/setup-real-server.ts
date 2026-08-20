import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket as ServerSocket } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach } from 'vitest';
import type {
  ClientSocketContract,
  ConnectOptions,
  ServerContext,
  ServerContract,
} from './contract';
import { makeConnectClients } from './connect-clients';

/** Build the `real` half of the shared dual-run `ServerContext`. */
export function setupRealServer(): ServerContext {
  const ctx = {} as ServerContext;
  let httpServer: HttpServer;
  let ioServer: Server;
  let port: number;
  let clients: ClientSocket[] = [];

  const asClientContract = (client: ClientSocket): ClientSocketContract =>
    client as unknown as ClientSocketContract;

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

    // Sequential connections pair this pending event with this exact client.
    const [serverSocket] = await Promise.all([
      serverConnection,
      new Promise<void>((resolve) => client.once('connect', () => resolve())),
    ]);

    clients.push(client);
    return { client: asClientContract(client), serverSocket };
  };

  // A rejected middleware connection emits `connect_error`, never `connect`.
  ctx.openClient = ({ namespace = '/', auth, query, forceNew, multiplex }: ConnectOptions = {}) => {
    const client = io(`http://localhost:${port}${namespacePath(namespace)}`, {
      transports: ['websocket'],
      auth,
      query,
      forceNew,
      multiplex,
    });
    clients.push(client);
    return asClientContract(client);
  };

  // Deliberately does not call `ioServer.of(namespace)` or `ctx.nextConnection`:
  // either would register the namespace and turn the rejection fixture into an
  // admission fixture before the client sends its namespace connect packet.
  ctx.openUnregisteredClient = (namespace: string) => {
    const client = io(`http://localhost:${port}${namespacePath(namespace)}`, {
      transports: ['websocket'],
    });
    clients.push(client);
    return asClientContract(client);
  };

  ctx.connectClients = makeConnectClients(ctx);

  return ctx;
}
