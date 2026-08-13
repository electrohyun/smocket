const { Server } = require('smocket');
const { expect, test } = require('@jest/globals');
const { connect } = require('./application.cjs');

test('maps the named CommonJS client import to smocket', async () => {
  const url = 'http://localhost:3011';
  const server = new Server(url);
  const received = new Promise((resolve) => {
    server.on('connection', (socket) => {
      socket.on('message', resolve);
    });
  });
  const client = connect(url);

  try {
    await new Promise((resolve) => client.once('connect', resolve));
    client.emit('message', 'from-jest');
    await expect(received).resolves.toBe('from-jest');
  } finally {
    client.disconnect();
    await server.close();
  }
});
