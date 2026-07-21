import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server, type Socket as ServerSocket } from "socket.io";
import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach } from "vitest";

export interface RealServerContext {
  client: ClientSocket;
  serverSocket: ServerSocket;
}

/**
 * Boots a real socket.io server and a connected client around each test.
 *
 * Returned as a mutable context so tests read `ctx.client` / `ctx.serverSocket`
 * after `beforeEach` has populated them. Kept as an explicit seam: the dual-run
 * setup will later swap this out for the smocket target behind an env var,
 * without touching the test files that consume the context.
 */
export function setupRealServer(): RealServerContext {
  const ctx = {} as RealServerContext;
  let httpServer: HttpServer;
  let ioServer: Server;

  beforeEach(async () => {
    httpServer = createServer();
    ioServer = new Server(httpServer);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const { port } = httpServer.address() as AddressInfo;

    ctx.client = io(`http://localhost:${port}`, { transports: ["websocket"] });

    await Promise.all([
      new Promise<void>((resolve) => {
        ioServer.on("connection", (s) => {
          ctx.serverSocket = s;
          resolve();
        });
      }),
      new Promise<void>((resolve) => ctx.client.on("connect", () => resolve())),
    ]);
  });

  afterEach(async () => {
    ctx.client.disconnect();
    await new Promise<void>((resolve) => {
      ioServer.close(() => resolve());
    });
  });

  return ctx;
}
