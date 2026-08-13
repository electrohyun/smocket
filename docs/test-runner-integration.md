# Test-runner integration

> **TL;DR** An application imports `io` from `socket.io-client`, and a test
> resolves that specifier to smocket instead, so the application code runs
> unchanged against an in-memory server. Vitest does it with `resolve.alias` or
> `vi.mock`, Jest with `moduleNameMapper`.

## What gets swapped

smocket exports `io` as an alias of `connect` for this path, so the module a test
substitutes carries the name application code already imports. Only the named
export exists, so an application written as `import io from 'socket.io-client'`
has to move to the named import first.

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
      'socket.io-client': 'smocket',
    },
  },
});
```

## Vitest, one file

`vi.mock` scopes the swap to a single file, which is what a suite that also runs
tests against a real server wants.

```ts
import { vi } from 'vitest';

vi.mock('socket.io-client', async () => {
  const smocket = await vi.importActual<typeof import('smocket')>('smocket');
  return { io: smocket.io };
});
```

`vi.mock` is hoisted above the imports, so the file still imports the application
module the normal way.

## Jest

`moduleNameMapper` is the alias equivalent. Jest resolves `smocket` through the
`require` condition, which reaches the CJS half of the dual build.

```js
// jest.config.cjs
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^socket\\.io-client$': 'smocket',
  },
};
```

An application module written as TypeScript ESM still needs whatever transform
the project already uses (babel-jest with `@babel/preset-typescript`, or ts-jest).
That part is not smocket-specific.

## Executable clean-consumer evidence

[`consumers/test-adoption/`](../consumers/test-adoption/) keeps the application
imports above unchanged and is assembled outside the checkout. Candidate validation
installs one explicit `npm pack` tarball; published validation installs the exact
registry version. The fixture reports the package input, requested and installed
versions, and resolved module path before running the suite-alias Vitest case, the
hoisted per-file Vitest mock, named-import Jest mapping, installed TypeScript
Node16 ESM/CJS checks, and a static namespace. Chromium runs the mapped application
against that same candidate tarball.

The runner deliberately requires an explicit `--tarball` and exact `--version` for
candidate mode. Release automation can therefore pass a previously verified archive
rather than repacking one during consumer validation.

## A fresh server per test

Construct a new `Server` on the same url in `beforeEach`, then close it in `afterEach`.
Construction puts the server in smocket's origin registry. `close()` disconnects its clients,
closes the old server, and removes that registry entry. The next `beforeEach` creates a new
server with a new adapter, so its rooms are empty.

```ts
import { connect, Server } from 'smocket';
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

One thing this does not reset. An acknowledgement timeout armed by a previous test,
through `socket.timeout(ms)` or `io.timeout(ms)`, holds its own reference and still fires
on schedule, which can be during a later test. Closing the server disconnects its sockets
and removes its registry entry but does not disarm what it already scheduled. A suite that
arms ack timeouts should let them settle before the test ends, either by awaiting the
acknowledgement or by driving the timer with fake timers. `io.close()` does not disarm an
already-armed timeout: real socket.io leaves that timer running too, so smocket keeps the
same lifecycle rather than making `close()` a timer-reset API. See
[decision 0020](./decisions/0020-close-follows-socket-lifecycle.md).

## Driving a connection directly

The exported `Server` has a Smocket-only direct connection API for tests that already hold the
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
