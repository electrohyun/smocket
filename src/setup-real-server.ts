import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket as ServerSocket } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach } from 'vitest';

export interface ConnectedClient {
  client: ClientSocket;
  serverSocket: ServerSocket;
}

export interface ConnectOptions {
  /** Namespace to attach to, `/` by default. */
  namespace?: string;
}

export interface RealServerContext {
  io: Server;
  /** Connect one more client and return it paired with its server-side socket. */
  connectClient: (options?: ConnectOptions) => Promise<ConnectedClient>;
  /**
   * Resolve with the server-side socket of the next client to connect on
   * `namespace`. Needed when the connection is not started by `connectClient`,
   * as with a reconnect of a client that is already known to the test.
   */
  nextConnection: (namespace?: string) => Promise<ServerSocket>;
}

/**
 * Boots a real socket.io server around each test and hands back a
 * `connectClient()` factory. Room / broadcast rules only show up with more than
 * one client (a member vs a non-member), so clients are connected on demand
 * rather than fixed at one. Every connected client is disconnected in
 * `afterEach`. Kept as an explicit seam: the dual-run setup will later swap this
 * out for the smocket target behind an env var, without touching the test files.
 */
export function setupRealServer(): RealServerContext {
  const ctx = {} as RealServerContext;
  let httpServer: HttpServer;
  let ioServer: Server;
  let port: number;
  let clients: ClientSocket[] = [];

  beforeEach(async () => {
    httpServer = createServer();
    ioServer = new Server(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;

    clients = [];
    ctx.io = ioServer;
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

  ctx.connectClient = async ({ namespace = '/' }: ConnectOptions = {}) => {
    const client = io(`http://localhost:${port}${namespace}`, {
      transports: ['websocket'],
    });

    // Connects are awaited one at a time, so the pending `connection` event
    // belongs to exactly this client — no id matching needed.
    const [serverSocket] = await Promise.all([
      ctx.nextConnection(namespace),
      new Promise<void>((resolve) => client.once('connect', () => resolve())),
    ]);

    clients.push(client);
    return { client, serverSocket };
  };

  return ctx;
}
