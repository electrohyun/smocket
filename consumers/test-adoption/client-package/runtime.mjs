import assert from 'node:assert/strict';
import client, { connect, io } from 'smocket-client';
import { connectSharedWorker as clientConnectSharedWorker } from 'smocket-client/shared-worker';
import { Server } from 'smocket';
import { connectSharedWorker as rootConnectSharedWorker } from 'smocket/shared-worker';

assert.equal(client, io);
assert.equal(io, connect);
assert.equal(clientConnectSharedWorker, rootConnectSharedWorker);

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
