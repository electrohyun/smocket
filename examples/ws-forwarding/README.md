# Node ws forwarding example

> **TL;DR** The same forwarding handler runs with real ws or smocket/ws. Three
> clients exchange text and bytes, one disconnects, and the remaining pair continues
> before every client and the server close.

## Run from this checkout

Use Node 20 or later. From the repository root:

```sh
pnpm install
pnpm build
node examples/ws-forwarding/demo.mjs mock
node examples/ws-forwarding/demo.mjs real
```

The real target opens a loopback server; the mock target keeps the same calls in
memory. The demo prints each client's received messages and membership changing
from three clients to two, then zero. It exits after closing the clients and server.

## Use the handler

[`app.cjs`](./app.cjs) walks server.clients and forwards to open sockets, preserving
the incoming binary flag. It uses default client tracking. Pass includeSender=true
to attachForwarding to send each message back to its sender as well.

```js
import WebSocket, { WebSocketServer } from 'smocket/ws';
```

Change the import source to ws for the real library. With CommonJS, smocket uses
an explicit default constructor lookup:

```js
const WebSocket = require('smocket/ws').default;
const { WebSocketServer } = require('smocket/ws');
```

Real ws instead uses the constructor returned directly by require('ws'). Keep each
server/client pair on the same loader. The [ws contract](../../docs/ws-contract.md)
defines the selected Node API.

## Compare the application

```sh
node examples/ws-forwarding/verify.mjs
node examples/ws-forwarding/verify.cjs
pnpm check:ws-package --tarball <path-to-smocket-tarball>
```

Both loaders run sender exclusion and inclusion, mixed payload order, and delivery
after B disconnects. A later message from B establishes exclusion at A. A socket's
close event ends its incoming sequence. [`scenario.cjs`](./scenario.cjs) closes each
client before awaiting server.close and terminates remaining sockets in finally.

The package command copies this example into a separate project, installs the given
tarball and real ws there, and repeats both comparisons and demo targets. The
[release-candidate gate](../../docs/release-candidates.md) supplies that same artifact.
