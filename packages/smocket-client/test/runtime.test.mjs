import assert from 'node:assert/strict';
import test from 'node:test';
import client, { connect, io } from '../dist/index.mjs';
import { Server } from 'smocket';
import { connectSharedWorker as rootConnectSharedWorker } from 'smocket/shared-worker';
import { connectSharedWorker } from '../dist/shared-worker.mjs';

test('ESM exports one lookup function', () => {
  assert.equal(client, io);
  assert.equal(io, connect);
});

test('ESM shared-worker entry re-exports the exact peer implementation', () => {
  assert.equal(connectSharedWorker, rootConnectSharedWorker);
});

test('ESM facade and peer share the server registry', async () => {
  const server = new Server('http://localhost:4276');
  const accepted = server.nextConnection('/team');
  const socket = client('http://localhost:4276/team', {
    auth: { userId: 'alice' },
    query: { source: 'esm' },
    forceNew: true,
  });

  try {
    const serverSocket = await accepted;
    assert.deepEqual(serverSocket.handshake.auth, { userId: 'alice' });
    assert.deepEqual(serverSocket.handshake.query, { source: 'esm' });
    assert.equal(socket.connected, true);
    assert.equal(socket.disconnected, false);
    assert.equal(socket.recovered, false);
    assert.deepEqual(socket.auth, { userId: 'alice' });
  } finally {
    await server.close();
  }
});
