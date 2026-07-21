import { expect, it } from "vitest";
import { setupRealServer } from "./setup-real-server";

const ctx = setupRealServer();

it("연결되면 양쪽 다 socket id를 가진다", () => {
  expect(ctx.client.connected).toBe(true);
  expect(ctx.client.id).toBeTruthy();
  expect(ctx.serverSocket.id).toBe(ctx.client.id);
});

it("클라이언트 -> 서버 emit이 도착한다", async () => {
  const received = new Promise<string>((resolve) => {
    ctx.serverSocket.on("ping", resolve);
  });
  ctx.client.emit("ping", "hello");
  await expect(received).resolves.toBe("hello");
});

it("ack 콜백이 돌아온다", async () => {
  ctx.serverSocket.on(
    "sum",
    (a: number, b: number, ack: (n: number) => void) => {
      ack(a + b);
    },
  );
  const result = await ctx.client.emitWithAck("sum", 1, 2);
  expect(result).toBe(3);
});
