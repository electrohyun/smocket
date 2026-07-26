import { expect, it } from 'vitest';
import { Server } from './index';

it('연결하면 client와 server socket이 같은 id로 짝지어진다', async () => {
  const server = new Server();
  const client = server.connect();
  const serverSocket = await server.nextConnection();

  expect(client.connected).toBe(true);
  expect(client.id).toBeTruthy();
  expect(serverSocket.id).toBe(client.id);
});
