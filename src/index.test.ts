import { expect, it } from 'vitest';
import { Server } from './index';

it('connecting pairs the client and server socket with the same id', async () => {
  const server = new Server();
  const client = server.connect();
  const serverSocket = await server.nextConnection();

  expect(client.connected).toBe(true);
  expect(client.id).toBeTruthy();
  expect(serverSocket.id).toBe(client.id);
});
