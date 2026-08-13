import { Server } from 'smocket';
import { expect, test } from 'vitest';
import { createClient } from '../shared/client.js';

test('selects a registered static namespace through the runner-mapped client', async () => {
  const url = 'http://localhost:3015';
  const server = new Server(url);
  const admin = server.of('/admin');
  const connected = new Promise((resolve) => admin.on('connection', resolve));
  const { client } = createClient(`${url}/admin`);

  try {
    await new Promise((resolve) => client.once('connect', resolve));
    const socket = await connected;
    expect(socket.nsp.name).toBe('/admin');
  } finally {
    client.disconnect();
    await server.close();
  }
});
