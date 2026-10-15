// Checked JavaScript exercises the exact require() spelling used by consumers.
const WebSocket = require('smocket/ws').default;
const { WebSocketServer } = require('smocket/ws');
const client = new WebSocket('ws://localhost:3000');

client.on('message', (data) => {
  if (!(data instanceof ArrayBuffer)) data.readUInt32BE(0);
});

// @ts-expect-error Extra client options are excluded.
new WebSocket('ws://localhost:3000', {});

// @ts-expect-error Blob inputs are excluded.
client.send(new Blob());

const server = new WebSocketServer({ port: 0, clientTracking: false });

// @ts-expect-error clients is undefined with tracking disabled.
server.clients.add(client);
