import assert from 'node:assert/strict';
import client, { connect, io } from 'smocket-client';
import { Server } from 'smocket';

assert.equal(client, io);
assert.equal(io, connect);

const server = new Server('http://localhost:3276');
const accepted = server.nextConnection('/external');
const socket = client('http://localhost:3276/external', {
  auth: { userId: 'esm' },
  query: { source: 'tarball' },
  forceNew: true,
});

try {
  const serverSocket = await accepted;
  assert.equal(socket.connected, true);
  assert.deepEqual(serverSocket.handshake.auth, { userId: 'esm' });
  assert.deepEqual(serverSocket.handshake.query, { source: 'tarball' });
} finally {
  await server.close();
}
