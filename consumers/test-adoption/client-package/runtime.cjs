const assert = require('node:assert/strict');
const client = require('smocket-client');
const { connectSharedWorker: clientConnectSharedWorker } = require('smocket-client/shared-worker');
const { Server } = require('smocket');
const { connectSharedWorker: rootConnectSharedWorker } = require('smocket/shared-worker');

assert.equal(typeof client, 'function');
assert.equal(client, client.io);
assert.equal(client.io, client.connect);
assert.equal(clientConnectSharedWorker, rootConnectSharedWorker);

async function main() {
  const server = new Server('http://localhost:3277');
  const accepted = server.nextConnection('/external');
  const socket = client('http://localhost:3277/external', {
    auth: { userId: 'cjs' },
    query: { source: 'tarball' },
    multiplex: false,
  });

  try {
    const serverSocket = await accepted;
    assert.equal(socket.connected, true);
    assert.deepEqual(serverSocket.handshake.auth, { userId: 'cjs' });
    assert.deepEqual(serverSocket.handshake.query, { source: 'tarball' });
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
