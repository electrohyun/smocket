import { expect, it } from 'vitest';
import type { ServerSocketContract } from './contract';
import { setupServer } from './setup-server';

const ctx = setupServer();

it('both sides have a socket id once connected', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  expect(client.connected).toBe(true);
  expect(client.disconnected).toBe(false);
  expect(client.id).toBeTruthy();
  expect(serverSocket.connected).toBe(true);
  expect(serverSocket.disconnected).toBe(false);
  expect(serverSocket.recovered).toBe(false);
  expect(serverSocket.id).toBe(client.id);
});

it('server connection state changes at the same lifecycle boundaries as socket.io', async () => {
  const states: Array<[string, boolean, boolean, boolean]> = [];
  ctx.io.use((socket, next) => {
    states.push(['middleware', socket.connected, socket.disconnected, socket.recovered]);
    next();
  });
  ctx.io.on('connection', (socket) => {
    states.push(['connection', socket.connected, socket.disconnected, socket.recovered]);
    socket.on('disconnecting', () => {
      states.push(['disconnecting', socket.connected, socket.disconnected, socket.recovered]);
    });
    socket.on('disconnect', () => {
      states.push(['disconnect', socket.connected, socket.disconnected, socket.recovered]);
    });
  });

  const { client, serverSocket } = await ctx.connectClient();
  const disconnected = new Promise<void>((resolve) =>
    serverSocket.once('disconnect', () => resolve()),
  );
  client.disconnect();
  await disconnected;

  expect(states).toEqual([
    ['middleware', false, true, false],
    ['connection', true, false, false],
    ['disconnecting', true, false, false],
    ['disconnect', false, true, false],
  ]);
});

it('a socket id is 20 characters of url-safe base64', async () => {
  // The shape real socket.io emits, which 0011 says smocket copies. It was stated
  // there and pinned nowhere, so the generator could change shape without a test
  // noticing — and it did (#139), where a browser bundle could not produce an id at
  // all while this Node suite stayed green. Running dual, so the shape is read off
  // the real target rather than asserted about it.
  const clients = await ctx.connectClients(5);
  for (const { client } of clients) {
    expect(client.id).toMatch(/^[A-Za-z0-9_-]{20}$/);
  }
});

it("io.on('connection') fires with the connecting server socket", async () => {
  const connected = new Promise<ServerSocketContract>((resolve) => {
    ctx.io.on('connection', (socket: ServerSocketContract) => resolve(socket));
  });
  const { client } = await ctx.connectClient();
  const serverSocket = await connected;
  expect(serverSocket.id).toBe(client.id);
});

it("io.on('connect') is a synonym for 'connection' on the server", async () => {
  // Real socket.io fires `connect` alongside `connection` on the namespace, so an
  // app that wires handlers through `io.on('connect')` must work on smocket too.
  const connected = new Promise<ServerSocketContract>((resolve) => {
    ctx.io.on('connect', (socket: ServerSocketContract) => resolve(socket));
  });
  const { client } = await ctx.connectClient();
  const serverSocket = await connected;
  expect(serverSocket.id).toBe(client.id);
});

it('a client-to-server emit arrives', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const received = new Promise<string>((resolve) => {
    serverSocket.on('ping', resolve);
  });
  client.emit('ping', 'hello');
  await expect(received).resolves.toBe('hello');
});

it('a client-to-server ack comes back', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('sum', (a: number, b: number, ack: (n: number) => void) => {
    ack(a + b);
  });
  const result = await client.emitWithAck('sum', 1, 2);
  expect(result).toBe(3);
});

it('a server-to-client ack comes back', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('sum', (a: number, b: number, ack: (n: number) => void) => {
    ack(a + b);
  });
  const result = await serverSocket.emitWithAck('sum', 1, 2);
  expect(result).toBe(3);
});
