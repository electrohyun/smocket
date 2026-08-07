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

## What keeps its types

The application keeps socket.io-client's own types, because the alias is a
runtime resolution and TypeScript still reads the real package. Test code that
names a smocket value annotates with the exported contract types, of which
`ServerContract`, `ServerSocketContract`, `ClientSocketContract`,
`NamespaceContract` and `Handshake` are the entry points.
