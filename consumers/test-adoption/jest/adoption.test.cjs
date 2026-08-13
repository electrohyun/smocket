const { Server } = require('smocket');
const { expect, test } = require('@jest/globals');
const { connect } = require('./application.cjs');

test('maps the client import to the selected substitute', () => {
  const mappedClient = require('socket.io-client');
  const selectedClient = require(process.env.SMOCKET_CLIENT_TARGET || 'smocket');

  expect(mappedClient.io).toBe(selectedClient.io);
  expect(mappedClient.connect).toBe(selectedClient.connect);
});

test('maps the named CommonJS client import to the installed substitute', async () => {
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
