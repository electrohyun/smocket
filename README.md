<p align="center">
  <img src="https://ik.imagekit.io/electrohyun/smocket_logo?tr=w-320" width="320" alt="smocket logo" />
</p>

<h1 align="center">smocket</h1>

<p align="center">
  Socket.IO mock library with full room · namespace · broadcast support.<br />
  <em>Sweet setup, rocket speed.</em>
</p>

<p align="center">
  <!-- One workflow badge covering both the real and mock jobs; it goes red if
       either target regresses. -->
  <a href="https://github.com/electrohyun/smocket/actions/workflows/ci.yml">
    <img src="https://github.com/electrohyun/smocket/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI (real + mock)" />
  </a>
</p>

<p align="center">
  <!-- The landing site. Its interactive demo is still being built, so this points
       at the site and not at a demo. -->
  <a href="https://smocket-site.vercel.app">smocket-site.vercel.app</a>
</p>

> **Status: pre-1.0.** The delivery core (rooms, namespaces, broadcasts, acks, disconnect) is complete and checked against real socket.io by a dual-run conformance suite. The idiomatic `io.on('connection')` entry point and URL-based `connect(url, { auth, query })` now work (see [Usage](#usage)), populating `socket.handshake`; the `nextConnection` pairing helper stays for tests that drive a connection directly. The public API can still change before 1.0.0.

## Why smocket

Socket.IO delivery is more than event propagation. Room membership, namespace isolation, and broadcast exclusion rules interact to decide a single question: who actually receives this event?

smocket aims to reproduce that delivery logic faithfully. Every behavior is specified by a conformance suite that runs against a real Socket.IO server first — smocket is implemented to match it. It fills the gap left by existing mock libraries, none of which support rooms, namespaces, and broadcasts in full.

The [conformance report](docs/conformance.md) lists every behavior that comparison covers, each linking to the test that pins it, along with the surface it does not reach yet. It is generated from the run, so a behavior is listed only because both targets passed it.

## Install

```bash
npm install -D smocket
```

## Usage

```ts
import { connect, Server } from 'smocket';

const io = new Server('http://localhost:3000');

// The server-side entry point, exactly as in real socket.io: wire per-socket
// handlers as each client connects. `socket.handshake` carries the client's auth
// and query, so the same code an app runs on socket.io runs here.
io.on('connection', (socket) => {
  console.log('connected as', socket.handshake.auth.name);
  socket.on('join', (room) => {
    socket.join(room);
    socket.to(room).emit('user-joined', socket.id);
  });
});

// Clients connect by URL, resolved to the server through smocket's origin registry.
// A second argument passes auth and query through, socket.io-client's `io(url, opts)`.
const a = connect('http://localhost:3000', { auth: { name: 'a' } });
const b = connect('http://localhost:3000', { auth: { name: 'b' } });

a.on('user-joined', (id) => console.log('a saw', id));

// Emits sent before the connection completes are buffered and flushed in order,
// so a joins room-1 before b does.
a.emit('join', 'room-1');
b.emit('join', 'room-1');
// b joins after a, so a receives 'user-joined' (b's id); b does not, since it is the sender.
```

To run an existing app against smocket without touching the app's own code, point
`socket.io-client` at smocket in your test runner. [Test-runner integration](docs/test-runner-integration.md)
has the Vitest and Jest setups.

## Features

- Socket ID assignment and tracking
- `emit` / `on` / acknowledgements
- Room `join` / `leave` with bidirectional membership
- Broadcasts: `io.to` · `socket.to` · `socket.broadcast` · `except`
- Namespace isolation
- Multi-client simulation
- Membership cleanup on `disconnect`

## Scope

smocket reproduces the delivery and routing layer of Socket.IO. The following are out of scope:

- Reconnection
- Transport fallback
- Heartbeat
- Multi-server setups via the Redis adapter
- Binary encoding

These belong to the transport layer, which has no meaning in an in-memory mock.

## Roadmap

- **v0.1.0** (2026-07-30). Core delivery layer: socket lifecycle, emit/on with acknowledgements, room join/leave, broadcast variants, and namespace isolation, verified against a real Socket.IO server.
- **v0.2.0** (2026-07-30). Extensibility: public adapter API with a working example, multi-client simulation helpers, and a stable public surface for 1.0.
- **v0.3.0** (2026-08-03). App-facing entry points: `io.on('connection')`, `connect(url)`, and the `io` alias, so code written for socket.io runs against smocket.
- **v0.4.0** (2026-08-06). The remaining public API surface: connection middleware, acknowledgement timeouts, `volatile`, catch-all listeners, `socket.data`, listener removal, and `except` chaining, plus packaging verification and a browser run in CI.
- **v1.0.0** (planned). First stable release: complete documentation, usage examples, and a published conformance test report.

Beyond 1.0, extensions such as a devtools panel and a Storybook addon are under consideration.

smocket's conformance suite also serves as a close look at how Socket.IO actually behaves — anything worth reporting, we hope to contribute back upstream.

See the [milestones](https://github.com/electrohyun/smocket/milestones) for progress and open items. The API is subject to change until 1.0.

## Contributing

Contributions are welcome. The most useful ones encode how Socket.IO actually behaves, so tests that pin smocket to real Socket.IO matter most here.

Good places to start:

- Issues labelled [`good first issue`](https://github.com/electrohyun/smocket/labels/good%20first%20issue) are scoped to not need the whole codebase. _None open yet as of July 2026 — they'll appear as the core lands._
- The [milestones](https://github.com/electrohyun/smocket/milestones) show what each release is aiming for.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit conventions, and how pull requests are merged.

## Contributors

[![Contributors](https://contrib.rocks/image?repo=electrohyun/smocket)](https://github.com/electrohyun/smocket/graphs/contributors)

## License

MIT License
