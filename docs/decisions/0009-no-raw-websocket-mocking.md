# 0009. smocket does not mock raw WebSocket

**Status:** Accepted · 2026-07-28 · #66

> **TL;DR** smocket does not mock the raw WebSocket transport. Raw WebSocket
> interception is MSW's lane; smocket's lane is socket.io delivery semantics, the
> routing layer. Scope stays on which sockets receive an event, not the byte
> transport under it.

## Decision

We do not mock raw WebSocket. smocket reproduces socket.io's delivery and routing
layer: which socket receives which event, in which [room](../glossary.md#room) and
[namespace](../glossary.md#namespace), and in what order. It does not intercept
the WebSocket frames that a real socket.io connection rides on. Intercepting raw
WebSocket, or the HTTP long-poll transport beneath socket.io, is a transport-level
concern that MSW already covers, and reproducing it would put smocket in that lane
instead of its own.

The two lanes answer different questions. A raw-WebSocket mock answers "what bytes
crossed the wire"; smocket answers "given these emits, joins, and broadcasts,
which sockets receive what." The socket.io semantics (rooms,
[broadcast](../glossary.md#broadcast) targeting, [acks](../glossary.md#ack)) sit
above the transport, and a test that wants those semantics does not want to
hand-assemble socket.io's wire protocol on top of a WebSocket fake. Staying at the
routing layer is what lets a test read in socket.io's own terms.

## Alternatives rejected

- **Mock raw WebSocket and let callers run real socket.io on top.** This
  reproduces the transport but not the semantics, so every test would still
  rebuild room and broadcast behaviour by hand, which is the work smocket exists
  to remove. It also duplicates what MSW already does at that layer.
- **Mock at the transport for fidelity to the wire.** The wire format is not what
  smocket's tests assert on; they assert on delivery. Transport fidelity would add
  surface without serving the question the project answers.
