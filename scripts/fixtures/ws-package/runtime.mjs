import assert from 'node:assert/strict';
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
}
