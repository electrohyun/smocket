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

The test supplies the server the application would otherwise talk to. A fresh
`Server` on the same url in `beforeEach` replaces the one the previous test
registered for that origin, so nothing carries over between tests.

```ts
// the test file, identical under all three setups below
import { Server, type ServerSocketContract } from 'smocket';
import { joinChat } from '../src/chat';

const url = 'http://localhost:3000';

beforeEach(() => {
  const io = new Server(url);
  io.on('connection', (socket: ServerSocketContract) => {
    socket.on('join', (room: string, ack: () => void) => {
      socket.join(room);
      ack();
      socket.on('message', (text: string) => {
        socket.to(room).emit('message', `${socket.handshake.auth.name}: ${text}`);
      });
    });
  });
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

The connection callback carries an annotation because the listener type is not
event-specific yet (#171). The rest is the server wiring an application already
knows from socket.io.

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

## A fresh server per test

Construct a new `Server` on the same url in `beforeEach`. There is no teardown call to
pair it with and there is none to call: the url is the key in smocket's origin registry,
so constructing again replaces the entry, and the next `connect(url)` reaches the new
server, whose rooms are empty because its adapter is new too.

What the registry decides is only who `connect(url)` finds. The previous server no longer
answers it, so a new client reaches the new one. Sockets already paired with the previous
server keep working in both directions, because a pairing is a reference between the two
sides rather than a lookup, so a client held across tests still talks to the server it
connected to. Constructing the clients per test as well is what keeps state from crossing.

```ts
import { connect, Server, type ServerSocketContract } from 'smocket';
import { beforeEach, expect, test } from 'vitest';

const URL = 'http://localhost:3000';
// The class is its own type, which is all a variable declared beside the `new` needs.
// `SmocketServer` is for the positions where the class is not in hand, such as a helper
// that takes a server as a parameter.
let io: Server;

beforeEach(() => {
  io = new Server(URL);
  // The socket parameter is annotated because the listener type erases it. See
  // "Annotating the connection listener" below.
  io.on('connection', (socket: ServerSocketContract) => {
    socket.on('join', (room: string, ack: () => void) => {
      void socket.join(room);
      ack();
    });
  });
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

The second test is the assertion that matters. It reads the room the first one filled and
finds nothing, which is only true because `beforeEach` replaced the server.

One thing this does not reset. An acknowledgement timeout armed by a previous test,
through `socket.timeout(ms)` or `io.timeout(ms)`, holds its own reference and still fires
on schedule, which can be during a later test. Replacing the server routes new connections
away from the old one but does not disarm what it already scheduled. A suite that arms ack
timeouts should let them settle before the test ends, either by awaiting the
acknowledgement or by driving the timer with fake timers. A `close()` that disarms them is
[not implemented yet](https://github.com/electrohyun/smocket/issues/193).

## Annotating the connection listener

`io.on('connection', ...)` gives its listener no parameter type. The contract declares
listeners as `(...args: never[]) => void`, which is what lets a handler of any arity be
passed without the call site fighting the compiler, and the cost is that an unannotated
parameter is inferred as `never`. Reading a member off it does not compile. Whether the
listener side can be narrowed at all is measured in
[#171](https://github.com/electrohyun/smocket/issues/171), which found no alternative to
keeping this shape.

```ts
io.on('connection', (socket) => {
  socket.on('join', handler); // Property 'on' does not exist on type 'never'
});
```

Annotate it, and the rest follows from there.

```ts
io.on('connection', (socket: ServerSocketContract) => {
  socket.on('join', handler); // fine
});
```

This is a type-level detail only. The unannotated form runs correctly, so JavaScript
suites never meet it, and a TypeScript suite meets it on the first line it writes.

## What keeps its types

The application keeps socket.io-client's own types, because the alias is a
runtime resolution and TypeScript still reads the real package. Test code that
names a smocket value annotates with the exported contract types, of which
`ServerContract`, `ServerSocketContract`, `ClientSocketContract`,
`NamespaceContract` and `Handshake` are the entry points.
