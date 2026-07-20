import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server, type Socket as ServerSocket } from "socket.io";
import { io, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, expect, it } from "vitest";

let httpServer: HttpServer;
let ioServer: Server;
let client: ClientSocket;
let serverSocket: ServerSocket;

beforeEach(async () => {
  httpServer = createServer();
  ioServer = new Server(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;

  client = io(`http://localhost:${port}`, { transports: ["websocket"] });

  await Promise.all([
    new Promise<void>((resolve) => {
      ioServer.on("connection", (s) => {
        serverSocket = s;
        resolve();
      });
    }),
    new Promise<void>((resolve) => client.on("connect", () => resolve())),
  ]);
});

afterEach(async () => {
  client.disconnect();
  await new Promise<void>((resolve) => {
    ioServer.close(() => resolve());
  });
});

it("연결되면 양쪽 다 socket id를 가진다", () => {
  expect(client.connected).toBe(true);
  expect(client.id).toBeTruthy();
  expect(serverSocket.id).toBe(client.id);
});

it("클라 → 서버 emit이 도착한다", async () => {
  const received = new Promise<string>((resolve) => {
    serverSocket.on("ping", resolve);
  });
  client.emit("ping", "hello");
  await expect(received).resolves.toBe("hello");
});

it("ack 콜백이 돌아온다", async () => {
  serverSocket.on("sum", (a: number, b: number, ack: (n: number) => void) => {
    ack(a + b);
  });
  const result = await client.emitWithAck("sum", 1, 2);
  expect(result).toBe(3);
});
