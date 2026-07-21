<p align="center">
  <img src="https://ik.imagekit.io/electrohyun/smocket_logo?tr=w-320" width="320" alt="smocket logo" />
</p>

<h1 align="center">smocket</h1>

<p align="center">
  Socket.IO mock library with full room · namespace · broadcast support.<br />
  <em>Sweet setup, rocket speed.</em>
</p>

## Why smocket

Socket.IO delivery is more than event propagation. Room membership, namespace isolation, and broadcast exclusion rules interact to decide a single question: who actually receives this event?

smocket aims to reproduce that delivery logic faithfully. It fills the gap left by existing mock libraries, none of which support rooms, namespaces, and broadcasts in full.

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

## Status

Early development. The API is subject to change.

## License

MIT
