/** Compile-only examples resolved from the installed package. */
import WebSocket, { WebSocket as NamedWebSocket, WebSocketServer } from 'smocket/ws';
import type { EventListener, RawData, Server, ServerOptions, WebSocketModule } from 'smocket/ws';
import * as moduleExports from 'smocket/ws';

const commonjs: WebSocketModule = moduleExports;
const constructor: typeof WebSocket = NamedWebSocket;
new commonjs.default('ws://localhost:3000');
new constructor.WebSocket('ws://localhost:3000');
new constructor.WebSocketServer({ port: 0 });

const server = new WebSocketServer({ port: 0 }, function () {
  console.log(this.address()?.port);
});
const annotatedServer: Server = server;
server.on('connection', (socket, request) => {
  const url: undefined = socket.url;
  console.log(request.url, request.method, request.headers.host, url);
  socket.send('reply');
});
server.clients.forEach((socket) => socket.close(1000, 'done'));

const options: ServerOptions<false> = { port: 0, clientTracking: false };
new WebSocketServer(options).clients?.forEach((socket) => socket.close());

const untracked = new WebSocketServer({ port: 0, clientTracking: false });
const noClients: undefined = untracked.clients;
const typedUntracked: Server<false> = untracked;
const explicitUndefined: undefined = new WebSocketServer({ port: 0, clientTracking: undefined })
  .clients;
console.log(annotatedServer, typedUntracked, noClients, explicitUndefined);

const client = new WebSocket(new URL('ws://localhost:3000'));
const annotatedClient: WebSocket = client;
const url: string = client.url;
client.on('message', (data, isBinary) => {
  const payload: RawData = data;
  console.log(isBinary, payload.byteLength);

  // @ts-expect-error Message data is typed bytes.
  data.notARealMethod();
});
const listener: EventListener<'message'> = (event) => console.log(event.data);
client.addEventListener('message', listener, { once: true });
client.send(new Uint8Array([1, 2]), { binary: true }, (error) => console.log(error?.message));
client.once('close', (code, reason) => console.log(code, reason.toString('utf8')));
console.log(annotatedClient, url, WebSocket.OPEN, client.CLOSED);

// @ts-expect-error The module object is not a constructor.
new moduleExports('ws://localhost:3000');

// @ts-expect-error Extra client options are excluded.
new WebSocket('ws://localhost:3000', {});

// @ts-expect-error Blob inputs are excluded.
client.send(new Blob());

// @ts-expect-error clients is undefined with tracking disabled.
untracked.clients.add(client);

type AssertFalse<Value extends false> = Value;
export type ConstructorIsNotAny = AssertFalse<0 extends 1 & typeof WebSocket ? true : false>;
export type RawDataIsNotAny = AssertFalse<0 extends 1 & RawData ? true : false>;
