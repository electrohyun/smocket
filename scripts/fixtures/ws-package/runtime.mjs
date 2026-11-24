import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import WebSocket, { WebSocket as NamedWebSocket, WebSocketServer } from 'smocket/ws';

const require = createRequire(import.meta.url);
const commonjs = require('smocket/ws');

// Check each loader internally; cross-loader state belongs to the real runtime.
for (const exports of [
  { default: WebSocket, WebSocket: NamedWebSocket, WebSocketServer },
  commonjs,
]) {
  assert.equal(typeof exports, 'object');
  assert.equal(exports.default, exports.WebSocket);
  assert.equal(exports.default.WebSocket, exports.default);
  assert.equal(exports.default.WebSocketServer, exports.WebSocketServer);
  assert.doesNotThrow(() => Reflect.construct(Object, [], exports.default));
  assert.doesNotThrow(() => Reflect.construct(Object, [], exports.WebSocketServer));

  for (const [name, value] of Object.entries({ CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })) {
    assert.equal(exports.default[name], value);
  }
  if (process.argv.includes('--delivery')) await exchange(exports);
}

async function exchange(exports) {
  const server = new exports.WebSocketServer({ port: 0, host: '127.0.0.1' });
  const clients = new Set();
  server.on('connection', (socket) => clients.add(socket));
  try {
    await once(server, 'listening');
    const address = server.address();

    assert.ok(address && address.port > 0);

    for (let cycle = 0; cycle < 2; cycle++) {
      const accepted = once(server, 'connection');
      const client = new exports.default(`ws://127.0.0.1:${address.port}/chat?room=one`);
      clients.add(client);
      await once(client, 'open');
      const [socket, request] = await accepted;

      assert.ok(socket instanceof exports.default);
      assert.equal(socket.url, undefined);
      assert.equal(request.url, '/chat?room=one');
      assert.equal(request.method, 'GET');
      assert.equal(server.clients.has(socket), true);

      socket.binaryType = 'arraybuffer';
      const incoming = once(socket, 'message');

      const written = new Promise((resolve, reject) => {
        client.send(Buffer.from('hello'), { binary: true }, (error) => {
          if (error) reject(error);
          else resolve(error);
        });
      });
      const [[data, binary], result] = await Promise.all([incoming, written]);

      assert.ok(data instanceof ArrayBuffer);
      assert.equal(Buffer.from(data).toString(), 'hello');
      assert.equal(binary, true);
      assert.equal(result, null);

      const reply = once(client, 'message');

      socket.send('reply');
      const [text, isBinary] = await reply;

      assert.equal(text.toString(), 'reply');
      assert.equal(isBinary, false);

      const ended = Promise.all([once(client, 'close'), once(socket, 'close')]);

      client.close(1000, 'done');
      const closeResults = await ended;

      for (const [code, reason] of closeResults) {
        assert.equal(code, 1000);
        assert.equal(reason.toString(), 'done');
      }
      assert.equal(server.clients.size, 0);

      clients.delete(client);
      clients.delete(socket);
    }
  } finally {
    for (const client of clients) {
      client.on('error', () => {});
      client.terminate();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}
