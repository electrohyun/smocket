# 0014. io.on('connection') fires the server side before the client connect

**Status:** Accepted · 2026-07-31 · #88

> **TL;DR** `io.on('connection')` is smocket's server-side app entry point: it
> fires once per new server socket, before that connection's client `connect`,
> through the same one `defer` as the connect itself. It arrives with `connect(url)`
> and the missing-server path as one bundle, because the three are a single
> timeline, not three separate features.

## Decision

`io.on('connection', cb)` runs `cb` with each new server-side socket, socket.io's
primary way to wire per-socket handlers, and the on-based counterpart to the
`nextConnection` harness path. `io.on(...)` targets the default namespace, exactly
`io.of('/').on(...)`, so it never sees a connection on another namespace.

The handler fires **before** that connection's client `connect`. Within the one
deferred step that completes a pairing ([0004](./0004-connection-deferred-one-tick.md)),
the server socket is registered and joins its id-room, is offered to any
`nextConnection`, then the `connection` handlers run, and only then does the client
`connect` fire. This is the order real socket.io uses: the server side is
observable first, so a `connection` handler can already broadcast to the new
socket, which is why the socket is in the roster and its id-room before the handler
runs. Both `nextConnection` and `on('connection')` see the same socket; they are
two ways to reach one connection, not two connections.

The `connection` event rides the **same `defer`** as the connect and the first
emits ([0010](./0010-single-defer-primitive-and-fifo.md)), not a second clock. One
FIFO queue is what keeps the connection handler, `nextConnection`, and the client
`connect` deterministically ordered; two schedulers would give no ordering
guarantee between them.

These app-facing entry points are one bundle because their timings interlock. A
client connects by url, resolved to a server through the origin registry
([0002](./0002-construction-is-activation.md),
[0003](./0003-url-is-required.md)), and the url's path selects the namespace. When
the origin has a server, the pairing completes on the timeline above and the
`connection` handler runs; when it has none, the client fires `connect_error` and
the handler simply never runs ([0005](./0005-missing-server-behavior.md)). The
handler firing, the one-tick defer, and `connect_error`-on-missing are the same
sequence of events, so designing them apart would split one timeline three ways.

`io.on('connect')` is a synonym for `io.on('connection')`, because real socket.io
fires both on the namespace for each new socket. Verified by a dual-run test:
listening on either reaches the same connection, so an app written against
`io.on('connect')` runs on smocket unchanged. Beyond those two, no event name has a
source on the namespace (0000): they are accepted but never fire, because a mock has
nothing else to raise there.

The origin registry ([0003](./0003-url-is-required.md)) is keyed by normalized
origin, and a second `new Server(url)` for the same origin **overwrites** the first,
last write wins. There is no real behaviour to copy here — two real servers on one
port collide at the OS with `EADDRINUSE`, but the registry is a mock-only mechanism
with no dual-run counterpart (like the adapter, `differences.md` §B), so this is a
smocket design choice rather than a fidelity question. Overwrite is chosen so the
universal test pattern, a fresh `new Server(url)` in `beforeEach`, just works without
a teardown step. Because of that, the registry's reset is `resetRegistry`, exported
from `mock-server.ts` but deliberately **not** re-exported from the package index: it
is a test-only affordance for a suite that registers servers and needs lookups
isolated between cases, not part of the 1.0 public surface.

## Alternatives rejected

- **Fire `connection` after, or at the same time as, the client `connect`.** A
  handler that broadcasts to the new socket would then race the client's own
  `connect`, and real socket.io makes the server side observable first, so the
  after/simultaneous order would disagree with the reference on the ordering a
  `connection` handler depends on.
- **Put the `connection` event on its own scheduler.** A separate clock from the
  connect and the first emits gives no ordering guarantee between them, the same
  reason 0010 keeps one `defer`; a `connection` handler could then miss the order a
  real server guarantees.
- **Expose only a harness hook (`nextConnection`) and no real `on('connection')`.**
  The harness path pairs a connect with its server socket, but code written for
  real socket.io wires handlers through `io.on('connection')`; without it, that code
  cannot run on smocket at all, which is the gap this issue closes.
