# Troubleshooting test adoption

> **TL;DR** Start with the URL, namespace, and resolved client package. Smocket keeps
> Socket.IO-compatible errors generic where Socket.IO does, while its origin registry
> and package substitution have explicit signals and cleanup rules.

The runtime examples below use one shared setup unless an entry says otherwise.

```ts
import { Server } from 'smocket';
import { connect } from 'smocket-client';

const URL = 'http://localhost:3000';
```

An [ack](./glossary.md#ack) is the response callback attached to an event. An
[origin registry](./glossary.md#origin-registry) is Smocket's in-process lookup from a
protocol, host, and port to a server.

## 1. A malformed URL

- **Reproduce:** call `connect('http://[')` or use a relative URL in Node without a
  `location.origin`.
- **Signal:** `connect()` throws a synchronous native `TypeError`. Its message belongs to
  the JavaScript URL implementation and is not a stable Smocket contract.
- **Cause and action:** the URL cannot become an absolute URL. Pass a valid absolute URL in
  Node, or provide the browser origin that a relative URL needs.
- **Classification:** Smocket exposes the native URL parser at its boundary. A real
  Socket.IO client need not fail at lookup construction, so do not assert parity or exact
  text here. See [decision 0003](./decisions/0003-url-is-required.md).

## 2. A missing or mismatched origin

Minimal reproduction:

```ts
new Server('http://localhost:3000');
const client = connect('http://localhost:3001');
client.on('connect_error', console.error);
```

- **Signal:** on the next tick the client emits an `Error` whose message contains
  `no server registered for http://localhost:3001`. Smocket also logs a line beginning
  `[smocket] connect_error`, does not throw from `connect()`, and does not retry.
- **Cause and action:** protocol, hostname, or port differs, or the server was not created
  yet. Make both URLs name the same normalized origin and construct the server first.
- **Classification:** this immediate one-shot failure and console diagnostic are
  Smocket-specific. Real Socket.IO uses network retries. The contract is pinned in
  [connect-url.test.ts](../src/connect-url.test.ts) and
  [decision 0005](./decisions/0005-missing-server-behavior.md).

## 3. An invalid namespace

Minimal reproduction:

```ts
new Server(URL);
connect(`${URL}/private`).on('connect_error', console.error);
```

- **Signal:** the client receives `Error('Invalid namespace')`, stays disconnected, and
  gets no id. Smocket writes no extra console diagnostic.
- **Cause and action:** the static [namespace](./glossary.md#namespace) does not exist.
  Call `io.of('/private')` before connecting, and check the URL path spelling.
- **Classification:** the signal is Socket.IO-compatible and intentionally generic. It is
  pinned in [namespace.test.ts](../src/namespace.test.ts).

## 4. Connection middleware rejection

Minimal reproduction:

```ts
const io = new Server(URL);
io.use((_socket, next) => {
  const error = Object.assign(new Error('unauthorized'), { data: { code: 401 } });
  next(error);
});
connect(URL).on('connect_error', console.error);
```

- **Signal:** the client receives `connect_error` with message `unauthorized` and
  `error.data` equal to `{ code: 401 }`. It never reaches `connection`.
- **Cause and action:** middleware called `next(error)`. Register `connect_error` before
  opening the client, then inspect its auth input and the middleware-owned `data` value.
- **Classification:** message and data propagation are Socket.IO-compatible. The message
  comes from application middleware, not from a richer Smocket diagnostic. See
  [middleware.test.ts](../src/middleware.test.ts).

## 5. Reserved event emission

Minimal reproduction:

```ts
new Server(URL);
const client = connect(URL);
await new Promise((done) => client.once('connect', done));
client.emit('disconnect');
```

- **Signal:** ordinary, timeout, and volatile `emit()` calls throw
  `Error('"disconnect" is a reserved event name')`. `emitWithAck()` returns a rejected
  promise with the same error.
- **Cause and action:** lifecycle names cannot be application events. Rename the event and
  listen for `disconnect` instead of emitting it.
- **Classification:** the error is Socket.IO-compatible on client, socket, namespace, and
  broadcast surfaces. See [reserved-events.test.ts](../src/reserved-events.test.ts).

## 6. Acknowledgement timeout

Minimal reproduction:

```ts
const io = new Server(URL);
io.on('connection', (socket) => socket.on('save', () => {}));
const client = connect(URL);
client.timeout(20).emit('save', 'draft', (error) => {
  if (error) throw error;
});
```

- **Signal:** when the peer does not call the trailing ack, the callback receives one
  `Error('operation has timed out')`. `timeout(ms).emitWithAck()` rejects with that error,
  and a late ack is ignored.
- **Cause and action:** the handler did not ack, took longer than the chosen duration, or
  never ran because setup targeted the wrong client. Ack every intended path, choose a
  deliberate duration, and await the result or drive fake timers before teardown.
- **Classification:** the generic error and one-shot settlement are Socket.IO-compatible.
  Smocket intentionally adds no event-specific text. See
  [timeout.test.ts](../src/timeout.test.ts).

## 7. Ordinary and volatile emits before connect

Minimal reproduction:

```ts
new Server(URL);
const client = connect(URL);
client.emit('ordinary', 'queued');
client.volatile.emit('volatile', 'dropped');
```

- **Signal:** no error is raised. The ordinary event is delivered after `connect`, while
  the volatile event is absent when a later ordinary marker arrives.
- **Cause and action:** the client is in the pre-connect window. Await `connect` before a
  volatile event that must arrive, or use an ordinary event when buffering is intended.
- **Classification:** this buffering and drop split matches Socket.IO 4.7 and 4.8. See
  [volatile.test.ts](../src/volatile.test.ts) and
  [decision 0016](./decisions/0016-volatile-drops-only-pre-connect.md).

## 8. Emits after disconnect

Minimal reproduction:

```ts
const io = new Server(URL);
io.on('connection', (socket) => {
  socket.on('save', (_payload, ack) => ack('saved'));
});
const client = connect(URL);
await new Promise((done) => client.once('connect', done));
const disconnected = new Promise((done) => client.once('disconnect', done));
client.disconnect();
await disconnected;
const pending = client.emitWithAck('save', { id: 1 });
client.connect();
await pending;
```

- **Signal:** an ordinary emit or new `emitWithAck()` made after disconnect buffers until
  a manual `connect()`. The promise stays pending and then settles after the new peer acks.
  An ack already in flight when disconnect begins rejects instead.
- **Cause and action:** application code reused a disconnected client. Stop emitting after
  disposal, or reconnect explicitly and wait for `connect` before expecting delivery.
- **Classification:** buffering and in-flight rejection match Socket.IO. Automatic
  reconnection timing remains outside Smocket's scope. See [ack.test.ts](../src/ack.test.ts)
  and [decision 0012](./decisions/0012-reject-inflight-acks-on-disconnect.md).

## 9. Connecting after server close

Minimal reproduction:

```ts
const io = new Server(URL);
await io.close();
connect(URL).on('connect_error', console.error);
```

- **Signal:** a later free lookup follows the missing-origin path from section 2 because
  `close()` unregisters the server. An attempt already crossing the close boundary emits
  `connect_error` with `server is closed` and never reaches `connection`.
- **Cause and action:** the test reused a closed server or began teardown before admission
  completed. Construct a fresh `Server` for the next test and await connection work before
  closing the current one.
- **Classification:** rejecting an in-flight connection is Socket.IO-compatible. Registry
  removal and the later missing-origin diagnostic are Smocket-specific. See
  [server-close.test.ts](../src/server-close.test.ts) and
  [decision 0020](./decisions/0020-close-follows-socket-lifecycle.md).

## 10. An incorrect Vitest or Jest alias

```ts
import * as mappedClient from 'socket.io-client';
import * as selectedClient from 'smocket-client';

expect(mappedClient.io).toBe(selectedClient.io);
expect(mappedClient.connect).toBe(selectedClient.connect);
```

- **Reproduce:** omit the alias, misspell either package, or load a config that does not
  contain the documented mapping. In Jest, make the same identity comparison with
  `require()`.
- **Signal:** package loading fails, the identity assertion fails, or the later connection
  behaves like real Socket.IO. Runner error wording is not a Smocket contract.
- **Cause and action:** the config was not selected or did not map the exact
  `socket.io-client` specifier to `smocket-client`. Fix `resolve.alias`, `vi.mock`, or
  `moduleNameMapper`, then keep the identity assertion while diagnosing.
- **Classification:** this belongs to the test runner. Smocket cannot diagnose a module
  that never resolved to it. The executable forms live in
  [consumers/test-adoption](../consumers/test-adoption/).

## 11. Accidentally running real Socket.IO

- **Reproduce:** import the application from `socket.io-client` without activating its
  test alias, while the test creates an in-memory `Server` from `smocket`.
- **Signal:** the client resolves from the real `socket.io-client` package, attempts a
  network connection, and may retry or leave a transport handle. There is no Smocket
  `[smocket] connect_error` line because Smocket never received the lookup.
- **Cause and action:** the runner used a production config, or the alias applied to a
  different project or file. Run the identity assertion in section 10 and print the
  installed paths with `require.resolve('smocket-client')` or
  `import.meta.resolve('smocket-client')` outside the transformed application.
- **Classification:** this is package resolution outside the Smocket runtime. Do not add a
  runtime detector for it.

## 12. Teardown, replacement, timers, and open handles

- **Reproduce:** construct two servers for `URL`, close the older one, or end a test while
  an acknowledgement timeout is armed.
- **Correct cleanup:** retain the active client and server references and settle them in
  teardown.

```ts
afterEach(async () => {
  client?.disconnect();
  await io.close();
});
```

- **Signal:** the newest `Server(URL)` owns that origin, so a second construction silently
  replaces the first. Closing the old server does not unregister the replacement. A server
  ack timeout armed before `close()` still fires afterward with
  `Error('operation has timed out')` and can keep a test process open until it settles.
- **Cause and action:** setup reused an origin, teardown closed the wrong instance, or a
  timer remained armed. Disconnect every retained client, await the current server's
  `close()`, and settle or drive every ack timer before the test ends.
- **Classification:** origin replacement is Smocket-specific. Disconnect order and the
  surviving ack timer match Socket.IO. See [connect-url.test.ts](../src/connect-url.test.ts),
  [server-close.test.ts](../src/server-close.test.ts), and
  [decision 0020](./decisions/0020-close-follows-socket-lifecycle.md).

## 13. ESM and CommonJS resolution

- **Reproduce:** load `Server` through ESM and the facade through CommonJS in one process,
  or map a default or callable client import directly to the root `smocket` package.
- **Signal:** mixed formats can produce `no server registered` for an apparently identical
  URL because two root module instances own separate registries. A wrong root mapping can
  instead fail at load time because the root has no client default or callable export.
- **Cause and action:** the server and facade crossed module formats, or the client alias
  points to the server package. Use `smocket-client` for client imports and keep both
  packages in ESM or both in CommonJS. Inspect the conditional exports in
  [the client manifest](../packages/smocket-client/package.json).
- **Classification:** dual-format loading is package behavior. Mixed-format registry
  sharing is explicitly unsupported by
  [decision 0023](./decisions/0023-client-package-is-a-thin-facade.md). The clean consumer
  runs ESM, callable CommonJS, Node16, and bundler cases separately.

## 14. Event-map type mismatch

- **Reproduce:** compile a server socket listener against the server-to-client map.

```ts
interface ClientToServer {
  join(room: string): void;
}

interface ServerToClient {
  ready(message: string): void;
}

const typed = new Server<ClientToServer, ServerToClient>(URL);
typed.on('connection', (socket) => socket.on('ready', () => {}));
```

- **Signal:** TypeScript rejects `ready` on the server socket because server sockets listen
  to client-to-server events. Compiler wording can change and is not a runtime signal.
- **Cause and action:** event maps were reversed or attached to the wrong socket side. A
  server socket listens to the first map and emits the second. A client `Socket` from
  `smocket-client` listens to the server map and emits the client map.
- **Classification:** the direction matches Socket.IO's type contract and has no runtime
  diagnostic. See the installed invalid fixture in
  [consumers/test-adoption/types/invalid](../consumers/test-adoption/types/invalid/) and
  [decision 0021](./decisions/0021-event-maps-cross-the-substitution-seam.md).
