# 0034. Packet middleware completes independently

**Status:** Accepted · 2026-08-13 · #268
**Governed by:** [0010](./0010-single-defer-primitive-and-fifo.md),
[0017](./0017-off-follows-the-emitter.md)

> **TL;DR** Client packets enter a server Socket's catch-all listeners and packet
> middleware in send order. Each packet then completes its asynchronous middleware
> independently, so a later packet may reach its named listener first.

## Decision

Socket.IO 4.7.5 and 4.8.3 both run incoming catch-all listeners before a server
Socket's middleware. Middleware receives one mutable `[event, ...args]` packet and
runs sequentially within that packet from a snapshot of the registered functions.

ADR 0010 continues to govern scheduling into packet processing. Packets enter
catch-all and middleware processing in send order through the shared defer point.
It does not impose a global queue after asynchronous middleware begins. A held packet
A and a later fast packet B run independently, so B may complete its named listener
and acknowledgement before A continues.

After a successful middleware chain, named dispatch occurs on the next tick only if
the Socket is still connected. `next(error)` stops that packet, emits the same Error
on the server Socket, and does not synthesize an acknowledgement.

The marker proof remains valid when all middleware for the earlier packet has already
settled before the later marker is sent. A marker cannot prove non-receipt while an
earlier packet is still deliberately held by asynchronous middleware.

## Alternatives rejected

- **Queue every packet behind unfinished middleware.** This preserves named-listener
  FIFO but differs from both supported Socket.IO versions.
- **Run middleware before catch-all listeners.** Catch-all listeners observe the
  original packet upstream, including the name and arguments later middleware mutates.
- **Read the live middleware array after each continuation.** Middleware registered
  during a packet would incorrectly begin processing that same packet.
- **Acknowledge rejected packets automatically.** Socket.IO leaves the acknowledgement
  callback unanswered when middleware rejects the packet.
