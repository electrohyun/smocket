# 0012. A pending emitWithAck is rejected on disconnect

**Status:** Accepted · 2026-07-28 · #67

> **TL;DR** When a client disconnects with an [ack](../glossary.md#ack) still
> pending, its `emitWithAck` promise is rejected rather than left hanging. This
> matches real socket.io-client, so it belongs in decisions, not in the
> differences list.

## Decision

If a client's `emitWithAck` is still waiting for a response when the client
disconnects, smocket rejects that promise. It does not leave the promise pending
forever. The `ClientSocket.disconnect` path drains the pending-ack rejecters for
exactly this reason.

This behaviour was verified against real socket.io-client, which settles a pending
`emitWithAck` on disconnect rather than hanging. Because smocket here does the same
thing real socket.io does, this is a point of agreement, so it is recorded as a
decision and does not appear in `differences.md`, which lists only the places
smocket deliberately diverges. The two other in-flight ack forms, a
trailing-callback ack and a server-to-client `emitWithAck`, also match real by
staying pending, and so need no special handling either.

## Alternatives rejected

- **Leave the promise pending indefinitely.** Simpler to implement, but it
  diverges from real socket.io-client and strands the caller's `await` with no
  resolution and no error, which is the failure this decision exists to prevent.
