import { expect, it } from 'vitest';
import client, { connect, io } from 'smocket-client';
import { Server } from 'smocket';

it('shares the browser registry and preserves the ESM lookup aliases', async () => {
  expect(client).toBe(io);
  expect(io).toBe(connect);

  const server = new Server('http://localhost:4278');
  const accepted = server.nextConnection('/browser');
  const socket = client('http://localhost:4278/browser', {
    auth: { source: 'browser' },
  });

  try {
    const serverSocket = await accepted;
    expect(serverSocket.handshake.auth).toEqual({ source: 'browser' });
    expect(socket.connected).toBe(true);
  } finally {
    await server.close();
  }
});
