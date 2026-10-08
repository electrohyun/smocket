# Test-runner integration

> **TL;DR** An application imports from `socket.io-client`, and a test resolves
> that specifier to `smocket-client`, so named, default, ESM, and CommonJS client
> imports run unchanged against an in-memory `smocket` server.

If setup fails before the first application event, start with the
[troubleshooting guide](./troubleshooting.md). It separates URL, namespace, lifecycle,
runner alias, package-format, and event-map failures by their actual signals.
For a complete application that runs unchanged against real Socket.IO and smocket,
follow the [drawing-game example](../examples/drawing-game/).

## Choose the client import path

Install `smocket` and `smocket-client` at the same exact version. An application can keep
importing `socket.io-client` and let its test runner map that name to `smocket-client`.
A test that owns its client connections can import from `smocket-client` directly.

`smocket-client` is a thin facade: its default, `io`, and `connect` exports are one
function, and its CommonJS root is callable with matching `.io` and `.connect` properties.
It delegates every lookup to its exact-version `smocket` peer. Use ESM for both imports or
CommonJS for both so the facade and a `Server` imported from `smocket` share one in-process
origin registry. Mixing formats can load separate root package instances.

The root package still exports named `io` and `connect` for existing aliases. New
package-name substitutions should use `smocket-client`, which also preserves default
imports and the client-side `Socket` type name.

```ts
// src/chat.ts, application code, unchanged by every setup below
import { io } from 'socket.io-client';

export function joinChat(url: string, name: string, room: string) {
  const socket = io(url, { auth: { name } });
  const ready = socket.emitWithAck('join', room);
  return {
    ready,
    send: (text: string) => socket.emit('message', text),
    onMessage: (handler: (line: string) => void) => socket.on('message', handler),
  };
}
```

The test supplies the server the application would otherwise talk to. `beforeEach`
creates it and `afterEach` closes it, so connection and adapter state do not carry
over between tests.

```ts
// the test file, identical under all three setups below
import { Server } from 'smocket';
import { joinChat } from '../src/chat';

const url = 'http://localhost:3000';
let io: Server;

beforeEach(() => {
  io = new Server(url);
  io.on('connection', (socket) => {
    socket.on('join', (room: string, ack: () => void) => {
      socket.join(room);
      ack();
      socket.on('message', (text: string) => {
        socket.to(room).emit('message', `${socket.handshake.auth.name}: ${text}`);
      });
    });
  });
});

afterEach(async () => {
  await io.close();
});

it('delivers a room message to the other member', async () => {
  const alice = joinChat(url, 'alice', 'general');
  const bob = joinChat(url, 'bob', 'general');
  await Promise.all([alice.ready, bob.ready]);

  const line = new Promise((resolve) => bob.onMessage(resolve));
  alice.send('hello');

  expect(await line).toBe('alice: hello');
});
```

The connection callback infers smocket's server socket. The rest is the server wiring an
application already knows from socket.io.

## Vitest, whole suite

`resolve.alias` redirects the specifier for every test file at once.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'socket.io-client': 'smocket-client',
    },
  },
});
```

## Vitest, one file

`vi.mock` scopes the swap to a single file, which is what a suite that also runs
tests against a real server wants.

```ts
import { vi } from 'vitest';

vi.mock('socket.io-client', () => import('smocket-client'));
```

`vi.mock` is hoisted above the imports, so the file still imports the application
module the normal way.

## Jest

`moduleNameMapper` is the alias equivalent. Jest resolves `smocket-client` through the
`require` condition, which reaches the CJS half of the dual build.

```js
// jest.config.cjs
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^socket\\.io-client$': 'smocket-client',
  },
};
```

An application module written as TypeScript ESM still needs whatever transform
the project already uses (babel-jest with `@babel/preset-typescript`, or ts-jest).
That part is not smocket-specific.

## Executable clean-consumer validation

[`consumers/test-adoption/`](../consumers/test-adoption/) keeps the application
imports above unchanged and is assembled outside the checkout. Candidate validation
installs explicit `smocket` and `smocket-client` tarballs at one version. Published
validation installs the exact versions selected by the
[published-consumer policy](./published-consumer-policy.md). The fixture reports both
installed module paths before running the Vitest and Jest adoption cases, facade ESM and
callable CommonJS cases, Node16 and bundler type checks, and static namespace coverage.
Chromium runs the mapped application and facade registry-sharing case against those
installed packages.

The runner deliberately requires explicit tarball paths and an exact version for
candidate mode. Release automation can therefore pass the same two archives through
every consumer check.

## A fresh server per test

Construct a new `Server` on the same url in `beforeEach`, then close it in `afterEach`.
Construction puts the server in smocket's origin registry. `close()` disconnects its clients,
closes the old server, and removes that registry entry. The next `beforeEach` creates a new
server with a new adapter, so its rooms are empty.

```ts
import { connect } from 'smocket-client';
import { Server } from 'smocket';
import { afterEach, beforeEach, expect, test } from 'vitest';

const URL = 'http://localhost:3000';
// The class is its own type, which is all a variable declared beside the `new` needs.
// `SmocketServer` is for the positions where the class is not in hand, such as a helper
// that takes a server as a parameter.
let io: Server;

beforeEach(() => {
  io = new Server(URL);
  io.on('connection', (socket) => {
    socket.on('join', (room: string, ack: () => void) => {
      void socket.join(room);
      ack();
    });
  });
});

afterEach(async () => {
  await io.close();
});

async function join(room: string) {
  const client = connect(URL);
  await new Promise<void>((done) => client.once('connect', () => done()));
  await new Promise<void>((done) => client.emit('join', room, () => done()));
}

test('a room joined here holds its member', async () => {
  await join('lobby');
  expect(io.of('/').adapter.rooms.get('lobby')?.size).toBe(1);
});

test('and is gone by the next test, because the server is a new one', () => {
  expect(io.of('/').adapter.rooms.get('lobby')).toBeUndefined();
});
```

The second test is the assertion that matters. `afterEach` closed the server that held the
room, and `beforeEach` supplied a new server with a new adapter, so the lookup finds nothing.

An acknowledgement timeout armed on a server Socket with `serverSocket.timeout(ms)`, or
on a broadcast with `io.timeout(ms)`, keeps running after server close. It can expire during
a later test, so let it settle before the test ends, either by awaiting the acknowledgement
or by driving the timer with fake timers. `io.close()` does not reset these timers, matching
real socket.io. See
[decision 0020](./decisions/0020-close-follows-socket-lifecycle.md).

For a client packet already sent, connection teardown rejects a pending `emitWithAck`
promise and calls a timed acknowledgement callback with `socket has been disconnected`.
It also clears that client's armed timer, so expiry cannot call it again. Untimed client
callbacks stay pending. See
[decision 0012](./decisions/0012-reject-inflight-acks-on-disconnect.md).

A client packet buffered before connection has not been sent. Its timed acknowledgement
keeps waiting for a later connection or its timeout. If the timeout expires first, the
packet is removed from the buffer. Settle these buffered operations before ending a test
too, since closing the server does not reset their timers.

## Driving a connection directly

The exported `Server` has a smocket-only direct connection API for tests that already hold the
server instance. `connect()` returns the client immediately, while `nextConnection()` returns
the admitted server-side Socket. Both accept a namespace and default to `/`.

```ts
const serverSocketPromise = io.nextConnection('/game');
const client = io.connect('/game', { auth: { token: 'test-user' } });
const serverSocket = await serverSocketPromise;

expect(serverSocket.id).toBe(client.id);
```

The example's `nextConnection('/game')` call also establishes that named static namespace. If a
test calls `connect('/game')` first, it must establish the namespace with `io.of('/game')`
beforehand. Once the namespace exists, the two API calls may be made in either order and pair
in FIFO order within that namespace. A rejected or cancelled admission is skipped. If
`io.close()` runs before a pending pairing can complete, that `nextConnection()` promise rejects
with `Error('server is closed')`. The full lifecycle contract is recorded in
[decision 0030](./decisions/0030-public-connection-api-settles-on-close.md).

## Preserving application event maps

The server accepts Socket.IO's event-map order. Its connection callback infers a socket
that listens to the client-to-server map and emits the server-to-client map.

```ts
interface ClientToServerEvents {
  join: (room: string, ack: (accepted: boolean) => void) => void;
}

interface ServerToClientEvents {
  message: (line: string) => void;
}

const typedIo = new Server<ClientToServerEvents, ServerToClientEvents>(URL);

typedIo.on('connection', (socket) => {
  socket.on('join', (room, ack) => {
    void socket.join(room);
    ack(true);
  });
  socket.emit('message', 'ready');
});
```

Misspelled events and wrong payloads fail at compile time. Omitting the maps keeps the
existing untyped form, so the quick setup does not require event interfaces. The full
four-slot decision, including `SocketData` and the type-only `ServerSideEvents` position,
is recorded in [decision 0021](./decisions/0021-event-maps-cross-the-substitution-seam.md).

## What keeps its types

The application keeps socket.io-client's own types, because the alias is a
runtime resolution and TypeScript still reads the real package. Test code that
names a smocket value annotates with the exported contract types, of which
`ServerContract`, `ServerSocketContract`, `ClientSocketContract`,
`NamespaceContract` and `Handshake` are the entry points.
The root type `Socket` is an alias of `ServerSocketContract`, matching the server-side
Socket.IO package name. The separate client package owns the client-side `Socket` name.
