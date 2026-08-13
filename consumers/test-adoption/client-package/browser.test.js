import { expect, test } from 'vitest';
import client, { connect, io } from 'smocket-client';
import { Server } from 'smocket';

test('loads the facade and its peer as one browser registry', async () => {
  expect(client).toBe(io);
  expect(io).toBe(connect);

  const server = new Server('http://localhost:3278');
  const accepted = server.nextConnection('/external');
  const socket = client('http://localhost:3278/external', {
    auth: { source: 'browser-tarball' },
  });

  try {
    const serverSocket = await accepted;
    expect(socket.connected).toBe(true);
    expect(serverSocket.handshake.auth).toEqual({ source: 'browser-tarball' });
  } finally {
    await server.close();
  }
});
