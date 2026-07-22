import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server, type Socket as ServerSocket } from 'socket.io';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach } from 'vitest';
import type { ConnectOptions, ServerContext } from './contract';

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
    // belongs to exactly this client, with no id matching needed.
    const [serverSocket] = await Promise.all([
      ctx.nextConnection(namespace),
      new Promise<void>((resolve) => client.once('connect', () => resolve())),
    ]);

    clients.push(client);
    return { client, serverSocket };
  };

  return ctx;
}
