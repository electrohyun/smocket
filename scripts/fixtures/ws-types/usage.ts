/** Compile-only contract examples. No ws implementation is executed. */
import type {
  AddressInfo,
  CloseEvent,
  ConnectionRequest,
  Data,
  RawData,
  Server,
  ServerOptions,
  WebSocket,
  WebSocketConstructor,
  WebSocketModule,
  WebSocketServer,
  WebSocketServerConstructor,
} from '../../../src/ws/contracts.js';

declare const WebSocket: WebSocketConstructor;
declare const WebSocketServer: WebSocketServerConstructor;
declare const commonjs: WebSocketModule;

new commonjs.default('ws://localhost:3000').send('default constructor');

// @ts-expect-error The CommonJS module object is not itself a constructor.
new commonjs('ws://localhost:3000');

const { WebSocketServer: CjsServer, WebSocket: CjsClient } = commonjs;
new CjsServer({ port: 0 });
new CjsClient('ws://localhost:3000');

// @ts-expect-error Server is a type alias, not a selected runtime constructor alias.
console.log(commonjs.Server);

const server = new WebSocketServer({ port: 0, host: '127.0.0.1', path: '/chat' }, function () {
  const address: AddressInfo | null = this.address();
  if (address) console.log(address.port, address.address, address.family);

  // @ts-expect-error The callback receiver supports only address().
  this.close();
});

server.on('connection', function (socket, request) {
  const info: ConnectionRequest = request;
  const url: undefined = socket.url;
  const typedSocket: WebSocket = socket;
  const address: ReturnType<WebSocketServer['address']> = this.address();

  console.log(info.url, info.method, info.headers.host, url, address);
  typedSocket.send('reply');

  // @ts-expect-error TCP peer metadata is excluded.
  console.log(request.socket.remoteAddress);

  // @ts-expect-error HTTP stream operations are excluded.
  request.destroy();
});
server.on('connection', (socket: WebSocket) => socket.send('explicit annotation'));
server.once('listening', () => {}).address();
server.on('error', (error) => console.log(error.message));
server.on('close', () => {});

const annotatedServer: Server = server;
const options: ServerOptions = { port: 0 };
console.log(annotatedServer, options);

for (const socket of server.clients) socket.send('broadcast');

new WebSocketServer({ port: 0, clientTracking: true }).clients.forEach((socket) =>
  socket.send('tracked'),
);

const untracked = new WebSocketServer({ port: 0, clientTracking: false });
const noClients: undefined = untracked.clients;

const explicitUndefined: undefined = new WebSocketServer({ port: 0, clientTracking: undefined })
  .clients;

const optionalSetting = new WebSocketServer(options);
optionalSetting.clients?.forEach((socket) => socket.send('optional setting'));
console.log(explicitUndefined);

const flag: boolean = Math.random() > 0.5;
new WebSocketServer({ port: 0, clientTracking: flag }).clients?.forEach((socket) => socket.close());
console.log(noClients);

const client = new WebSocket(new URL('ws://localhost:3000/chat'));
const url: string = client.url;
const annotatedClient: WebSocket = client;
const state: 0 | 1 | 2 | 3 = client.readyState;
console.log(url, annotatedClient, state === WebSocket.OPEN, client.CLOSED);

client.on('message', function (data, isBinary) {
  const payload: RawData = data;

  // @ts-expect-error Emitter message data is typed bytes, not an arbitrary object.
  data.notARealMethod();

  const ownUrl: string = this.url;
  console.log(
    isBinary,
    ownUrl,
    payload instanceof ArrayBuffer ? payload.byteLength : payload.toString('utf8'),
  );
});
client.once('close', (code, reason) => console.log(code, reason.toString('utf8')));
client.on('error', (error) => console.log(error.message));
client.once('open', () => {}).send('fluent');

const receive = (value: number) => console.log(value);
client.addListener('custom', receive).off('custom', receive).removeListener('custom', receive);

const custom = Symbol('custom');
const emitted: boolean = client.emit(custom, 42);
const names: (string | symbol)[] = client.eventNames();
console.log(emitted, names, client.listenerCount(custom, receive), client.listeners(custom));
client.rawListeners(custom)[0]?.listener?.(42);
client.removeAllListeners(custom).removeAllListeners();

client.binaryType = 'arraybuffer';
client.send(new DataView(new ArrayBuffer(4)), { binary: true }, (error) =>
  console.log(error?.message),
);
client.send(new Uint8Array([1, 2]), (error) => console.log(error?.message));
client.send(42);
client.send([1, 2]);
client.send({ valueOf: () => 'text' });
client.send({ [Symbol.toPrimitive]: () => 'text' });

client.addEventListener(
  'message',
  function (event) {
    const data: Data = event.data;
    const targetUrl: string | undefined = event.target.url;
    console.log(
      this.url,
      targetUrl,
      typeof data === 'string' ? data.toUpperCase() : data.byteLength,
    );
  },
  { once: true },
);

const listener = {
  handleEvent(event: CloseEvent) {
    console.log(event.code, event.reason, event.wasClean);
  },
};
client.addEventListener('close', listener);
client.removeEventListener('close', listener);

client.onmessage = function (event) {
  console.log(this.url, event.target.url, event.data);
};

client.onerror = (event) => {
  if (event.error instanceof Error) console.log(event.error.message);
};
client.onopen = () => {};
client.onclose = (event) => console.log(event.reason);
client.onmessage = null;

client.close(1000, 'done');
client.terminate();
server.close((error) => console.log(error?.message));

// @ts-expect-error Additional client options are excluded.
new WebSocket('ws://localhost:3000', { headers: { cookie: 'session=1' } });

// @ts-expect-error The port-based constructor requires port.
new WebSocketServer({});

// @ts-expect-error Blob inputs are excluded.
client.send(new Blob(['unsupported']));

// @ts-expect-error Fragmented representations are excluded.
client.binaryType = 'fragments';

// @ts-expect-error Compression options are excluded.
client.send('text', { compress: true });

// @ts-expect-error DOM capture options are excluded.
client.addEventListener('open', () => {}, { capture: true });

type AssertFalse<T extends false> = T;
export type RawDataIsNotAny = AssertFalse<0 extends 1 & RawData ? true : false>;
