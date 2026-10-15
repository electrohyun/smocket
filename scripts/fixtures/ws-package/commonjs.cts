/** Compile-only CommonJS imports, including consumers without Node types. */
import SocketModule = require('smocket/ws');

const WebSocket = SocketModule.default;
const { WebSocketServer } = SocketModule;
const client: SocketModule.WebSocket = new WebSocket('ws://localhost:3000');
const server: SocketModule.WebSocketServer<false> = new WebSocketServer({
  port: 0,
  clientTracking: false,
});
const options: SocketModule.ServerOptions<false> = { port: 0, clientTracking: false };
const listener: SocketModule.EventListener<'message'> = (event) => console.log(event.data);
const noClients: undefined = server.clients;
client.addEventListener('message', listener);
console.log(options, noClients, WebSocket.WebSocket, WebSocket.WebSocketServer);

// @ts-expect-error require() exposes a module object, not a direct constructor.
new SocketModule('ws://localhost:3000');

// @ts-expect-error Extra client options are excluded.
new WebSocket('ws://localhost:3000', {});

// @ts-expect-error Blob inputs are excluded.
client.send(new Blob());

type AssertFalse<Value extends false> = Value;
export type ConstructorIsNotAny = AssertFalse<0 extends 1 & typeof WebSocket ? true : false>;
