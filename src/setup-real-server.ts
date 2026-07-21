import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server, type Socket as ServerSocket } from "socket.io";
import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach } from "vitest";

export interface ConnectedClient {
  client: ClientSocket;
  serverSocket: ServerSocket;
}

export interface RealServerContext {
  io: Server;
  /** Connect one more client and return it paired with its server-side socket. */
  connectClient: () => Promise<ConnectedClient>;
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

  ctx.connectClient = async () => {
    const client = io(`http://localhost:${port}`, {
      transports: ["websocket"],
    });

    // Connects are awaited one at a time, so the pending `connection` event
    // belongs to exactly this client — no id matching needed.
    const [serverSocket] = await Promise.all([
      new Promise<ServerSocket>((resolve) => {
        ioServer.once("connection", (socket) => resolve(socket));
      }),
      new Promise<void>((resolve) => client.once("connect", () => resolve())),
    ]);

    clients.push(client);
    return { client, serverSocket };
  };

  return ctx;
}
