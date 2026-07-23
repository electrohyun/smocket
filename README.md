<p align="center">
  <img src="https://ik.imagekit.io/electrohyun/smocket_logo?tr=w-320" width="320" alt="smocket logo" />
</p>

<h1 align="center">smocket</h1>

<p align="center">
  Socket.IO mock library with full room · namespace · broadcast support.<br />
  <em>Sweet setup, rocket speed.</em>
</p>

<p align="center">
  <!-- Real target only; add the dual-run badge once mock is green. -->
  <a href="https://github.com/electrohyun/smocket/actions/workflows/ci.yml">
    <img src="https://github.com/electrohyun/smocket/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI" />
  </a>
</p>

## Why smocket

Socket.IO delivery is more than event propagation. Room membership, namespace isolation, and broadcast exclusion rules interact to decide a single question: who actually receives this event?

smocket aims to reproduce that delivery logic faithfully. Every behavior is specified by a conformance suite that runs against a real Socket.IO server first — smocket is implemented to match it. It fills the gap left by existing mock libraries, none of which support rooms, namespaces, and broadcasts in full.

## Install

```bash
npm install -D smocket
```

## Usage

```ts
import { MockServer } from 'smocket';

const io = new MockServer();

io.on('connection', (socket) => {
  socket.on('join', (room) => {
    socket.join(room);
    socket.to(room).emit('user-joined', socket.id);
  });
});

const a = io.connect();
const b = io.connect();

a.emit('join', 'room-1');
b.emit('join', 'room-1');
// a receives 'user-joined'; b does not, since it is the sender
```

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

- **v0.1.0 — Core delivery layer.** Socket lifecycle, emit/on with acknowledgements, room join/leave, broadcast variants, and namespace isolation — verified against a real Socket.IO server.
- **v0.2.0 — Extensibility.** Public adapter API with a working example, multi-client simulation helpers, and a stable public surface for 1.0.
- **v1.0.0 — First stable release.** Complete documentation, usage examples, and a published conformance test report.

Beyond 1.0, extensions such as a devtools panel and a Storybook addon are under consideration.

smocket's conformance suite also serves as a close look at how Socket.IO actually behaves — anything worth reporting, we hope to contribute back upstream.

See the [milestones](https://github.com/electrohyun/smocket/milestones) for progress and open items. The API is subject to change until 1.0.

## Contributing

Contributions are welcome. The most useful ones encode how Socket.IO actually behaves, so tests that pin smocket to real Socket.IO matter most here.

Good places to start:

- Issues labelled [`good first issue`](https://github.com/electrohyun/smocket/labels/good%20first%20issue) are scoped to not need the whole codebase. _None open yet as of July 2026 — they'll appear as the core lands._
- The [milestones](https://github.com/electrohyun/smocket/milestones) show what each release is aiming for.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit conventions, and how pull requests are merged.

## License

MIT License
