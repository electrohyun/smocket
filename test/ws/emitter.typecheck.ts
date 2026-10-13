/** Compile-only inference checks for the actual internal emitter implementation. */
import type { ByteBuffer, RawData } from '../../src/ws/contracts';
import type { WebSocket, WebSocketServer } from '../../src/ws/runtime';

declare const client: WebSocket;
declare const server: WebSocketServer;
declare function acceptClient(value: WebSocket): void;
declare function acceptServer(value: WebSocketServer): void;

const sameClient: WebSocket = client.addListener('message', function (data, isBinary) {
  acceptClient(this);
  const bytes: RawData = data;
  const binary: boolean = isBinary;
  this.send('reply');
  console.log(bytes.byteLength, binary);

  // @ts-expect-error Message payload inference must not fall back to any.
  data.notARealMethod();
});
client.once('close', function (code, reason) {
  acceptClient(this);
  const status: number = code;
  const bytes: ByteBuffer = reason;
  console.log(this.readyState, status, bytes.toString('utf8'));

  // @ts-expect-error Close reasons are byte data.
  reason.notARealMethod();
});
client.off('error', function (error) {
  acceptClient(this);
  console.log(this.readyState, error.message);

  // @ts-expect-error Error listener inference must not fall back to any.
  error.notARealMethod();
});
const sameServer: WebSocketServer = server.addListener('connection', function (socket, request) {
  acceptServer(this);
  const accepted: WebSocket = socket;
  const path: string = request.url;
  accepted.send('hello');
  console.log(this.address(), path, request.headers.host);

  // @ts-expect-error Request inference does not expose arbitrary HTTP operations.
  request.destroy();
});
server.removeListener('error', (error) => console.log(error.message));
client.rawListeners('custom')[0]?.listener?.(42);
const emitted: boolean = server.emit(Symbol('custom'), 42, 'payload');
console.log(sameClient, sameServer, emitted);

// @ts-expect-error Registration requires a callable listener.
client.on('message', 42);

// @ts-expect-error Removal requires a callable listener.
server.removeListener('connection', null);
