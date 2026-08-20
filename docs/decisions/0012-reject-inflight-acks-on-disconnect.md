# 0012. A pending emitWithAck is rejected on disconnect

**Status:** Accepted · 2026-07-28 · #67

> **TL;DR** When a client disconnects with an [ack](../glossary.md#ack) still
> pending, its `emitWithAck` promise is rejected rather than left hanging. A sent
> timed callback receives the same disconnect error once, while untimed callbacks
> and server-originated acknowledgements stay pending.

## Decision

If a client's `emitWithAck` is still waiting for a response when the client
disconnects, smocket rejects that promise. It does not leave the promise pending
forever. The `ClientSocket.disconnect` path drains the pending-ack rejecters for
exactly this reason.

This behaviour was verified against real socket.io-client, which settles a pending
`emitWithAck` on disconnect rather than hanging. Because smocket here does the same
thing real socket.io does, this is a point of agreement, so it is recorded as a
decision and does not appear in `differences.md`, which lists only the places
smocket deliberately diverges.

Every acknowledgement callback belongs to the connection generation that delivered
it. A receiver may retain that function, but invoking it after a client disconnect,
a server Socket disconnect, or server close is discarded. Reconnecting the same
client does not revive the old callback. This applies in both direct directions and
to each response in a broadcast collector.

The sender-side callback form then splits according to whether the client decorated it
with `timeout(ms)`. A sent timed callback receives one
`Error("socket has been disconnected")` when the client disconnects, the server Socket
disconnects it, or the server closes. That settlement clears the armed timer, so expiry
cannot invoke the callback again. An untimed callback and a server-to-client
`emitWithAck` remain pending. A disconnected broadcast recipient likewise remains
outstanding until the collector timeout, if any, settles the operation.

A client packet buffered before connection has not been sent and keeps its existing
reconnect behavior. Its timed callback becomes teardown-owned only when that buffered
packet is flushed into a connection.

## Alternatives rejected

- **Leave the promise pending indefinitely.** Simpler to implement, but it
  diverges from real socket.io-client and strands the caller's `await` with no
  resolution and no error, which is the failure this decision exists to prevent.
- **Let a retained callback acknowledge a later connection.** Reusing the client
  object does not reuse the upstream packet id or the connection that owned it.
