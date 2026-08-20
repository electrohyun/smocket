# 0020. close follows socket.io's socket lifecycle

**Status:** Accepted · 2026-08-10 · #193
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** Socket.io 4.7 and 4.8 share the close callback and lifecycle but differ in
> return value; smocket accepts the callback and returns the 4.8 promise. It leaves an armed
> server-side [ack](../glossary.md#ack) timeout running and removes this server from the
> [origin registry](../glossary.md#origin-registry) only while it owns the entry.

## Decision

Real socket.io 4.7 and 4.8 close every [namespace](../glossary.md#namespace) socket before its
listener. The server socket fires `disconnecting` and then `disconnect`, both with
`server shutting down`; the client observes `transport close`. A pending client `emitWithAck`
rejects with `socket has been disconnected`, and a sent timed client callback receives the same
error once. A pending server `emitWithAck` stays pending.
A connection started immediately before close never reaches `connection`; its client observes
`connect_error` instead, so close cannot resolve and then admit a socket that escaped teardown.
Both versions invoke an optional callback when close completes. A later callback receives
`ERR_SERVER_NOT_RUNNING`; in 4.8, the returned promise still resolves. Version 4.7 returns `void`,
while 4.8 returns `Promise<void>`. Smocket keeps the common callback and returns the 4.8 promise,
which adds completion to the older call shape without invalidating it.

An armed server acknowledgement timeout is separate from the connection teardown. Real socket.io
leaves its timer running, and its callback still receives `operation has timed out` after
`close()` resolves. Smocket does the same. Tests that arm one settle it before ending or drive
it with fake timers; `close()` is not a timer reset.

The origin registry has no socket.io counterpart, but leaving a closed server registered would
let a later `connect(url)` attach to an object that has been shut down. `close()` therefore
removes the entry when, and only when, the entry still points to that server. Closing an older
server after a replacement was constructed cannot unregister the replacement. A later connect
with no replacement follows the existing missing-server behavior in
[0005](./0005-missing-server-behavior.md).

## Alternatives rejected

- **Cancel armed acknowledgement timers.** Real socket.io does not, and cancellation would
  need an invented result for callbacks and promises whose timer disappeared.
- **Always delete the origin entry.** An old server could remove a newer server registered at
  the same origin.
- **Leave the closed server registered.** A later connection could activate a server after its
  lifecycle had ended.
