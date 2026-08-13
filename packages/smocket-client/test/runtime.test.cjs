const assert = require('node:assert/strict');
const test = require('node:test');
const client = require('../dist/index.cjs');
const { Server } = require('smocket');

test('CommonJS root is the lookup function and owns both aliases', () => {
  assert.equal(typeof client, 'function');
  assert.equal(client, client.io);
  assert.equal(client.io, client.connect);
});

test('CommonJS facade and peer share the server registry', async () => {
  const server = new Server('http://localhost:4277');
  const accepted = server.nextConnection('/team');
  const socket = client('http://localhost:4277/team', {
    auth: { userId: 'bob' },
    query: { source: 'cjs' },
    multiplex: false,
  });

  try {
    const serverSocket = await accepted;
    assert.deepEqual(serverSocket.handshake.auth, { userId: 'bob' });
    assert.deepEqual(serverSocket.handshake.query, { source: 'cjs' });
    assert.equal(socket.connected, true);
  } finally {
    await server.close();
  }
});
