<p align="center">
  <!-- The banner carries the wordmark and the one-line pitch, which is why no
       heading or tagline repeats them here. The alt text is what a reader gets
       when the image does not load, so it says the same thing in words. -->
  <img
    src="https://ik.imagekit.io/electrohyun/smocket.png"
    width="1280"
    alt="smocket. Mock Socket.IO without a server. Sweet as a s’more, fast as a rocket."
  />
</p>

<p align="center">
  <!-- One workflow badge covering both the real and mock jobs; it goes red if
       either target regresses. -->
  <a href="https://github.com/electrohyun/smocket/actions/workflows/ci.yml">
    <img src="https://github.com/electrohyun/smocket/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI (real + mock)" />
  </a>
  <a href="https://github.com/electrohyun/smocket/actions/workflows/published-consumer.yml">
    <img src="https://github.com/electrohyun/smocket/actions/workflows/published-consumer.yml/badge.svg?branch=main" alt="published package consumer" />
  </a>
  <a href="https://www.npmjs.com/package/smocket">
    <img src="https://img.shields.io/npm/v/smocket" alt="npm version" />
  </a>
  <a href="https://codecov.io/gh/electrohyun/smocket">
    <img src="https://img.shields.io/codecov/c/github/electrohyun/smocket" alt="coverage" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/npm/l/smocket" alt="license" />
  </a>
  <a href="CODE_OF_CONDUCT.md">
    <img src="https://img.shields.io/badge/code%20of%20conduct-contributor%20covenant-blue" alt="code of conduct" />
  </a>
</p>

<p align="center">
  <a href="https://smocket-site.vercel.app">smocket-site.vercel.app</a>
  ·
  <a href="https://smocket-site.vercel.app/docs">Documentation</a>
</p>

<p align="center">
  <a href="README.ko.md">🇰🇷 한국어</a>
</p>

## Why smocket?

When developing a Socket.IO frontend, you need to see several clients connect, join
rooms, and receive different events. Before the backend event API is ready, there is
nowhere in the frontend to run that flow, so work on the multi-client UI has to wait
too.

A hand-written socket object can call a listener, but it usually has one handler map.
It cannot choose recipients from room membership, namespace, a broadcast target, or
the lifetime of an acknowledgement. An HTTP mock can define requests and responses,
but it does not own that long-lived connection state or Socket.IO routing.

A separate local Socket.IO server is accurate, but it also needs another process,
configuration, and a reachable host. That makes it awkward for isolated component
development and static previews, especially when the frontend only needs the
application event layer.

## Run Socket.IO application events in memory

smocket creates distinct client and server sockets without opening a network server.
It runs the supported Socket.IO connection handlers, room and namespace membership,
targeted and broadcast delivery, acknowledgements, and socket lifecycle in the same
JavaScript environment as the frontend.

```ts
io.on('connection', (socket) => {
  socket.on('say', (room: string, text: string) => {
    socket.to(room).emit('said', text);
  });
});
```

The event handlers and domain logic inside the supported surface can be shared with
a real Socket.IO server. For several same-origin browser tabs, the explicit
[SharedWorker path](docs/shared-worker.md) lets those pages use one in-browser server
and one in-memory state. smocket does not reproduce network transport or replace a
production backend.

## Quick start

```bash
npm install -D smocket smocket-client
```

Install both packages at the same version. `smocket` owns the in-process server;
`smocket-client` provides the application-facing connection. Neither package
requires a test runner.

```ts
// quick-start.ts
import { Server } from 'smocket';
import { connect } from 'smocket-client';

const URL = 'http://localhost:3000';
const io = new Server(URL);

io.on('connection', (socket) => {
  socket.on('join', async (room: string, done: () => void) => {
    await socket.join(room);
    done();
  });

  socket.on('say', (room: string, text: string) => {
    socket.to(room).emit('said', text);
  });
});

const alice = connect(URL);
const bob = connect(URL);

const joinLobby = (client: ReturnType<typeof connect>) =>
  new Promise<void>((done) => client.emit('join', 'lobby', done));

try {
  await Promise.all([joinLobby(alice), joinLobby(bob)]);

  const bobHeard = new Promise<string>((done) => bob.once('said', done));
  alice.emit('say', 'lobby', 'hello');

  console.log(`Bob heard: ${await bobHeard}`);
} finally {
  await io.close();
}
```

Save the file and run it with the TypeScript runner already used by your project,
or use `npx tsx quick-start.ts` for a standalone copy. It prints
`Bob heard: hello`, then `close()` disconnects both clients and unregisters the
server. The repository's executable room and acknowledgement workflow is in
[`examples/chat-room`](examples/chat-room/); run it with `pnpm example:chat-room`.

An existing application can keep its `socket.io-client` import and map that package
name to `smocket-client` in the environment that uses the mock:

```ts
// application code
import { io } from 'socket.io-client';
```

See [test-runner integration](docs/test-runner-integration.md) for Vitest and Jest
mapping, or [package entry points](docs/package-entry-points.md) when the application
owns its imports directly.

## See it in a React drawing game

The [drawing game](examples/drawing-game/) is a React multi-user application that
runs in three browser pages. Its automated flow covers drawing, chat, answer
acknowledgements, the end of a round, page closure, refresh, and connection cleanup.

The smocket path hosts the session in a SharedWorker. The real path starts a Node
Socket.IO server. Both use the same application event handler, event types, domain
state, React UI, and user actions; only the connection bootstrap changes.

- [Open the browser demo](https://smocket-site.vercel.app/demo)
- Run the source with `pnpm example:drawing-game`
- Read the [interactive report](https://smocket-site.vercel.app/case-study) or the
  [reproducible case study](case-studies/drawing-game/)

## How the supported boundary stays checked

The project links each public claim to a maintained workflow rather than copying
test counts into this page.

| Question                                         | Maintained path                                                |
| ------------------------------------------------ | -------------------------------------------------------------- |
| Does delivery and routing match Socket.IO?       | [dual-run conformance](docs/conformance.md)                    |
| Can several browser tabs share one mock server?  | [Chromium and SharedWorker workflow](.github/workflows/ci.yml) |
| Does the event layer work in a real frontend?    | [React drawing game](examples/drawing-game/)                   |
| Can applications consume the published packages? | [clean consumer checks](consumers/test-adoption/)              |

The conformance report also names the surface not yet compared and every deliberate
difference. Package checks install release artifacts outside the workspace across
supported module, type, test-runner, browser, and SharedWorker entry paths.

## Move to a real Socket.IO server

When an application keeps `socket.io-client` as its import, remove the mock-only
mapping and point it at the real server. Start the network server and move the shared
application handler into that server's bootstrap. Event names, supported handler
shapes, and framework-independent domain logic can stay the same.

The parts that should change are the parts smocket deliberately does not provide:
transport configuration, authentication against real infrastructure, persistence,
cross-device access, reconnection, and scaling. Keep integration and end-to-end tests
for those boundaries.

## Out of scope

These are not unfinished transport features. A mock does not open a network
connection, so reproducing them would require behaviour with no live transport to
act on.

- **Reconnection behaviour reproduction.** There is no dropped network connection
  to re-establish. Application responses to a disconnected state can still be
  exercised directly.
- **Transport fallback.** There is no WebSocket or HTTP long-polling transport to
  switch between.
- **Heartbeat.** There is no live connection to ping or time out. The resulting
  disconnect state remains observable through `socket.disconnect()`.
- **Multi-server scaling.** One in-memory process has no second server for a Redis
  adapter to reach.
- **Binary encoding.** Nothing is serialised onto a wire, so there are no frames to
  encode. Binary-containing direct payloads stay on the documented
  [in-memory passthrough path](docs/scope.md#not-reproduced-reliability--network-layer);
  this is not binary protocol support.

See the complete [scope boundary](docs/scope.md) and
[deliberate differences](docs/differences.md) before relying on an API outside the
documented surface.

## FAQ

<details>
<summary>Does smocket replace a real Socket.IO server?</summary>

No. It runs the application event layer in memory for frontend development and
testing. A real backend is still required for transport, security, persistence,
cross-device use, and production operation.

</details>

<details>
<summary>Do I need Vitest, Jest, or another test runner?</summary>

No. The quick start is plain TypeScript, and the drawing game runs as a browser
application. Test runners are optional integration paths for projects that already
use them.

</details>

<details>
<summary>Can several browser tabs share the same state?</summary>

Yes, through `smocket/shared-worker` and `smocket-client/shared-worker`. Pages must
share the same origin, browser profile, worker URL, and worker name. The
[SharedWorker guide](docs/shared-worker.md) covers the lifecycle and storage boundary.

</details>

<details>
<summary>Will I rewrite the application when I switch to real Socket.IO?</summary>

The supported application event handlers, event names, and domain logic can be
shared. The connection bootstrap and real infrastructure still change, and code
outside smocket's documented scope needs its own integration checks.

</details>

<details>
<summary>How much has been compared with real Socket.IO?</summary>

The [generated conformance report](docs/conformance.md) is the exact boundary. Each
listed case runs against real Socket.IO and smocket from the same test file; the
report also lists unmeasured APIs and deliberate differences.

</details>

## Documentation

| Document or path                                             | What it answers                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| [Public documentation](https://smocket-site.vercel.app/docs) | the deployed documentation entry point                            |
| [Documentation map](docs/README.md)                          | where to go for adoption, guarantees, and maintenance             |
| [Package entry points](docs/package-entry-points.md)         | which server, client, and SharedWorker import to use              |
| [Drawing-game workflow](examples/drawing-game/)              | React development with smocket and real Socket.IO                 |
| [SharedWorker](docs/shared-worker.md)                        | sharing one in-browser server across same-origin tabs             |
| [Test-runner integration](docs/test-runner-integration.md)   | mapping `socket.io-client` in Vitest and Jest                     |
| [Conformance](docs/conformance.md)                           | behaviour compared with real Socket.IO and the unmeasured surface |
| [Scope and differences](docs/scope.md)                       | the supported layer; see also [differences](docs/differences.md)  |
| [Troubleshooting](docs/troubleshooting.md)                   | adoption failures by observed signal                              |
| [Roadmap](docs/roadmap.md)                                   | durable gates and the path toward v1.0.0                          |

The maintained Korean entry points are [README.ko.md](README.ko.md) and
[CONTRIBUTING.ko.md](CONTRIBUTING.ko.md). English documentation is authoritative;
the two Korean guides link to it instead of mirroring every page.

## Contributing

Contributions are welcome, and the most useful ones encode how Socket.IO actually
behaves.

The shortest route in is a conformance case, because it has a mechanical comparison.
Read the [current compared surface](docs/conformance.md) and
[how to add a case](docs/conformance.md#how-to-add-a-case) before starting.

The [milestones](https://github.com/electrohyun/smocket/milestones) show what each
release is aiming for, and the
[issue tracker](https://github.com/electrohyun/smocket/issues) carries the rest.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, where to report or propose work,
commit conventions, and how pull requests are merged. The
[Korean guide](CONTRIBUTING.ko.md) covers the same path. See
[AGENTS.md](AGENTS.md) for how to run the two test targets.

<a id="coc-ov-file"></a>

## Code of Conduct

Participation in smocket is governed by the
[Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## Contributors

[![Contributors](https://contrib.rocks/image?repo=electrohyun/smocket)](https://github.com/electrohyun/smocket/graphs/contributors)

## License

MIT. See [LICENSE](LICENSE). Third-party font and project asset provenance is
recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
