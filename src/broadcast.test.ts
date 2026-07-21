import { expect, it } from "vitest";
import { setupRealServer } from "./setup-real-server";
import { count, receive, track } from "./test-events";

const ctx = setupRealServer();

it("socket.broadcast.emit은 발신자를 제외한 전원에게 간다", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2 } = await ctx.connectClient();

  const got2 = receive(client2, "msg");
  const msg1 = track(client1, "msg");
  const marker1 = receive(client1, "marker");

  socket1.broadcast.emit("msg", "hello");
  socket1.emit("marker");

  await expect(got2).resolves.toBe("hello");
  await marker1;
  expect(msg1.received).toBe(false); // sender excluded
});

it("io.except(room)은 그 방에 속하지 않은 전원에게 간다", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2 } = await ctx.connectClient();
  await socket1.join("room");

  const got2 = receive(client2, "msg");
  const msg1 = track(client1, "msg");
  const marker1 = receive(client1, "marker");

  ctx.io.except("room").emit("msg", "hello");
  socket1.emit("marker");

  await expect(got2).resolves.toBe("hello");
  await marker1;
  expect(msg1.received).toBe(false); // room member excluded
});

it("to()에 배열을 주면 방들의 합집합에 전달한다", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3, serverSocket: socket3 } = await ctx.connectClient();
  await socket1.join("roomA");
  await socket2.join("roomB");
  // client3 is in neither room

  const got1 = receive(client1, "msg");
  const got2 = receive(client2, "msg");
  const out3 = track(client3, "msg");
  const marker3 = receive(client3, "marker");

  ctx.io.to(["roomA", "roomB"]).emit("msg", "hello");
  socket3.emit("marker");

  await expect(got1).resolves.toBe("hello");
  await expect(got2).resolves.toBe("hello");
  await marker3;
  expect(out3.received).toBe(false);
});

it("to()를 체이닝하면 방들의 합집합에 전달한다", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3, serverSocket: socket3 } = await ctx.connectClient();
  await socket1.join("roomA");
  await socket2.join("roomB");

  const got1 = receive(client1, "msg");
  const got2 = receive(client2, "msg");
  const out3 = track(client3, "msg");
  const marker3 = receive(client3, "marker");

  ctx.io.to("roomA").to("roomB").emit("msg", "hello");
  socket3.emit("marker");

  await expect(got1).resolves.toBe("hello");
  await expect(got2).resolves.toBe("hello");
  await marker3;
  expect(out3.received).toBe(false);
});

it("배열 합집합은 여러 방에 동시 소속이어도 한 번만 전달한다", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join("roomA");
  await socket1.join("roomB");

  const counter = count(client1, "msg");
  const done = receive(client1, "marker");

  ctx.io.to(["roomA", "roomB"]).emit("msg", "once");
  socket1.emit("marker");

  await done;
  expect(counter.count).toBe(1); // deduplicated
});

it("체이닝 합집합은 여러 방에 동시 소속이어도 한 번만 전달한다", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  await socket1.join("roomA");
  await socket1.join("roomB");

  const counter = count(client1, "msg");
  const done = receive(client1, "marker");

  ctx.io.to("roomA").to("roomB").emit("msg", "once");
  socket1.emit("marker");

  await done;
  expect(counter.count).toBe(1); // a per-call delivery would make this 2 and fail
});

it("in()은 to()의 별칭이다", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  await socket1.join("room");

  const got1 = receive(client1, "msg");
  const msg2 = track(client2, "msg");
  const marker2 = receive(client2, "marker");

  ctx.io.in("room").emit("msg", "hello");
  socket2.emit("marker");

  await expect(got1).resolves.toBe("hello");
  await marker2;
  expect(msg2.received).toBe(false);
});

it("socket.except(room)은 발신자와 그 방을 모두 제외한다", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();
  const { client: client3 } = await ctx.connectClient();
  await socket2.join("room");

  const got3 = receive(client3, "msg");
  const msg1 = track(client1, "msg");
  const msg2 = track(client2, "msg");
  const marker1 = receive(client1, "marker");
  const marker2 = receive(client2, "marker");

  socket1.except("room").emit("msg", "hello");
  socket1.emit("marker");
  socket2.emit("marker");

  await expect(got3).resolves.toBe("hello");
  await marker1;
  await marker2;
  expect(msg1.received).toBe(false); // sender excluded
  expect(msg2.received).toBe(false); // room member excluded
});

it("io.to(socketId)는 그 소켓에게만 전달한다 (자기 id 방)", async () => {
  const { client: client1, serverSocket: socket1 } = await ctx.connectClient();
  const { client: client2, serverSocket: socket2 } = await ctx.connectClient();

  const got2 = receive(client2, "msg");
  const msg1 = track(client1, "msg");
  const marker1 = receive(client1, "marker");

  ctx.io.to(socket2.id).emit("msg", "hello");
  socket1.emit("marker");

  await expect(got2).resolves.toBe("hello");
  await marker1;
  expect(msg1.received).toBe(false);
});

it("socket.rooms는 서버 전용이며 자기 id와 join/leave를 반영한다", async () => {
  const { serverSocket: socket1 } = await ctx.connectClient();

  // socket.rooms is a server-only concept; right after connecting it holds only the socket's own id room.
  expect(socket1.rooms).toBeInstanceOf(Set);
  expect(socket1.rooms.has(socket1.id)).toBe(true);
  expect(socket1.rooms.size).toBe(1);

  await socket1.join("room");
  expect(socket1.rooms.has("room")).toBe(true);
  expect(socket1.rooms.has(socket1.id)).toBe(true);

  await socket1.leave("room");
  expect(socket1.rooms.has("room")).toBe(false);
  expect(socket1.rooms.has(socket1.id)).toBe(true);
});
