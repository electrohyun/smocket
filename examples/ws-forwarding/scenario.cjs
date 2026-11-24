const { Buffer } = require('node:buffer');
const { once } = require('node:events');
const { attachForwarding } = require('./app.cjs');

const greeting = JSON.stringify({ from: 'A', text: 'hello' });

function marker(socket, value) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onMessage = (data, binary) => {
      if (binary || data.toString() !== value) return;
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => onError(new Error(`Socket closed before ${value}`));
    socket.on('message', onMessage);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function record(socket, errors) {
  const messages = [];
  socket.on('error', (error) => errors.push(error));
  socket.on('message', (data, binary) => {
    messages.push({ data: binary ? [...data] : data.toString(), binary });
  });
  return messages;
}

async function runScenario({ WebSocket, WebSocketServer }, { includeSender = false } = {}) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const clients = [];
  const peers = [];
  const errors = [];
  const messages = [];
  let stopped = false;
  server.on('error', (error) => errors.push(error));
  server.on('connection', (socket) => {
    peers.push(socket);
    socket.on('error', (error) => errors.push(error));
  });
  attachForwarding(server, WebSocket, { includeSender });

  try {
    await once(server, 'listening');
    const address = server.address();
    for (const name of ['A', 'B', 'C']) {
      const accepted = once(server, 'connection');
      const client = new WebSocket(`ws://127.0.0.1:${address.port}/${name}`);
      clients.push(client);
      messages.push(record(client, errors));
      await Promise.all([once(client, 'open'), accepted]);
    }
    const [a, b, c] = clients;
    const membership = [server.clients.size];

    const afterA = Promise.all([
      marker(b, 'marker:A'),
      marker(c, 'marker:A'),
      ...(includeSender ? [marker(a, 'marker:A')] : []),
    ]);
    a.send(greeting);
    a.send(Buffer.from([1, 2, 3]));
    a.send(Uint8Array.from([0, 4, 5, 0]).subarray(1, 3));
    a.send(Buffer.from('tail'), { binary: false });
    a.send('marker:A');
    await afterA;

    const afterB = Promise.all([
      marker(a, 'marker:B'),
      marker(c, 'marker:B'),
      ...(includeSender ? [marker(b, 'marker:B')] : []),
    ]);
    b.send('marker:B');
    await afterB;

    const bClosed = Promise.all([once(b, 'close'), once(peers[1], 'close')]);
    b.close(1000, 'left');
    const [bClose] = await bClosed;
    membership.push(server.clients.size);

    const afterLeave = Promise.all([
      marker(c, 'after:B-left'),
      ...(includeSender ? [marker(a, 'after:B-left')] : []),
    ]);
    a.send('after:B-left');
    await afterLeave;

    const remainingClosed = Promise.all([
      once(a, 'close'),
      once(peers[0], 'close'),
      once(c, 'close'),
      once(peers[2], 'close'),
    ]);
    a.close(1000, 'done');
    c.close(1000, 'done');
    const [aClose, , cClose] = await remainingClosed;
    membership.push(server.clients.size);
    await new Promise((resolve) => server.close(resolve));
    stopped = true;

    return {
      messages,
      membership,
      closes: [aClose, bClose, cClose].map(([code, reason]) => ({
        code,
        reason: reason.toString(),
      })),
      states: clients.map((client) => client.readyState),
      address: server.address(),
      errors,
    };
  } finally {
    for (const socket of [...clients, ...peers]) {
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }
    if (!stopped) await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { greeting, runScenario };
