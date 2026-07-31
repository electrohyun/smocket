import { expect, it } from 'vitest';
import { connect, io, Server } from './index';

it('connecting pairs the client and server socket with the same id', async () => {
  const server = new Server('http://localhost');
  const client = server.connect();
  const serverSocket = await server.nextConnection();

  expect(client.connected).toBe(true);
  expect(client.id).toBeTruthy();
  expect(serverSocket.id).toBe(client.id);
});

it("exports `io` as socket.io-client's name for connect, so a module swap works", async () => {
  // The substitution path: app code written as `import { io } from 'socket.io-client'`
  // runs unchanged once the module resolves to smocket.
  expect(io).toBe(connect);

  const server = new Server('http://localhost');
  const client = io('http://localhost');
  const serverSocket = await server.nextConnection();

  expect(client.id).toBe(serverSocket.id);
});
