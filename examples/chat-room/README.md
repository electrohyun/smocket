# Chat room example

One room, two clients, one broadcast. The smallest program that shows an event
reaching someone other than the sender, which is the routing a mock without
[rooms](../../docs/glossary.md#room) cannot reproduce.

## Run it

From the repository root, after `pnpm install`.

```bash
pnpm example:chat-room
```

```
[alice] bob joined
[bob] alice: hello
```

Both lines are fixed, and for two different reasons.

The first one is ordering that the library already guarantees. Connection
completion and every emit are scheduled through one FIFO defer
([0004](../../docs/decisions/0004-connection-deferred-one-tick.md),
[0010](../../docs/decisions/0010-single-defer-primitive-and-fifo.md)), so alice,
created first, also joins first. That first join is broadcast the same way as the
second, with `socket.to(room)`, which reaches the room and skips the sender. The
room holds nobody else at that point, so `alice joined` is sent and received by no
one, which is why the output opens with `bob joined` instead.

The second line is what the acknowledgements are for. Awaiting both joins holds
the message until bob is in the room. Without that, the message would sit in the
queue directly behind alice's own join and reach the server while bob was still
connecting, so the broadcast would find an empty room and the line would be lost.

## What it uses

- `new Server(url)` and `io.on('connection')`, the server entry point socket.io
  applications already write against.
- `connect(url, { auth })`, the client side, with the name read back on the
  server as `socket.handshake.auth.name`.
- `socket.join(room)` and `socket.to(room).emit(...)`, the
  [broadcast](../../docs/glossary.md#broadcast) that reaches the room and skips
  the sender.
- `emitWithAck`, which is what makes the last line deterministic rather than
  dependent on how far two clients happen to have got when the message is sent.

The server half is the code an application runs against real socket.io. Swapping
a real client for smocket inside a test runner is a separate setup, documented
under `docs/`.
