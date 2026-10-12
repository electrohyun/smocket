# ws application contract

> **TL;DR** The ws contract defines selected calls, events, and application-visible
> values independently of transport. Basic source typing is checked here; generated
> declarations, package exports, and independent consumers belong to [#562](https://github.com/electrohyun/smocket/issues/562).

## Target usage

```ts
import WebSocket, { WebSocketServer } from 'smocket/ws';

const server = new WebSocketServer({ port: 0 }, function () {
  const address = this.address();
  if (!address) return;

  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);

  client.on('error', console.error);
  client.on('message', () => client.close(1000, 'done'));
  client.on('close', () => server.close());
});

server.on('connection', (socket, request) => {
  console.log(request.url, request.method, request.headers.host);

  socket.on('error', console.error);
  socket.send('hello');
});
```

CommonJS uses `const WebSocket = require('smocket/ws').default` and
`const { WebSocketServer } = require('smocket/ws')`, as decided in
[0045](./decisions/0045-ws-commonjs-uses-default-export.md). No environment factory or
Buffer injection is required. These are target imports, not evidence of an available
runtime entry. The support decision and exclusions live in
[0044](./decisions/0044-ws-api-without-transport.md).

## Type contract

[`src/ws/contracts.ts`](../src/ws/contracts.ts) owns the selected types. A general
`WebSocket` annotation accepts both sides and has `url: string | undefined`; directly
constructed clients infer a string URL, while accepted server sockets infer undefined.
Event-object targets use the shared socket type. `clientTracking: false` makes the
typed `clients` read undefined; a boolean setting requires checking before iteration.
An omitted tracking setting defaults to true, while explicit undefined disables it as in ws.

Emitter message data is Buffer or ArrayBuffer even for text. Event-object message data
also permits strings. Close listeners receive a Buffer reason; close events expose a string.
When Node types are present, byte data retains the real Buffer type. Without them, a
small Uint8Array-based shape avoids a mandatory Node type dependency. `ErrorEvent.error`
is unknown. Custom string/symbol events retain ws's permissive listener signature.

Requests expose only url, method, and automatic basic headers. The constructor callback
has a separate receiver exposing address() only. The contract does not describe full
IncomingMessage or HTTP Server classes, and it does not create missing runtime behavior.

## Basic validation

Run `pnpm check:ws-types` (also included in `pnpm typecheck`). The compile-only fixtures
check inference, explicit socket annotations, callbacks, Buffer interoperability, and
rejection of excluded options. The no-Node case uses types=[] and skipLibCheck=false.
This checks the source contract, not generated declarations, module exports, a packed
package, runtime delivery, or all supported TypeScript versions.
