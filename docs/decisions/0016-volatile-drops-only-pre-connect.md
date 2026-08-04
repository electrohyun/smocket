# 0016. volatile is accepted and drops only in the pre-connect window

**Status:** Accepted · 2026-08-04 · #110
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** Real socket.io drops a `volatile` emit only when the transport cannot
> buffer, and otherwise delivers it like a normal emit. smocket's one buffer is the
> pre-connect tick (0004), so it drops volatile there and is a plain emit elsewhere.

## Decision

Measured against real socket.io 4.8.3 before deciding. When a socket is connected,
`volatile` behaves exactly like `emit`: the message is delivered, and it composes with
rooms and acknowledgements the same way a normal emit does. The only case where a real
server drops a volatile message is when the transport is not ready to write it.
Concretely, an emit sent before the connection opens is buffered and delivered once
connected if it is normal, but discarded if it is volatile.

smocket has no transport and no send buffer, so that drop condition has no source here,
with one exception: the single tick between a connection being requested and the socket
being connected, where smocket does hold a message (0004). That window is the one place
a volatile emit has an observable meaning to reproduce. So smocket drops a volatile emit
sent during the pre-connect window and delivers a normal one, and outside that window
`volatile` is exactly `emit`.

Because this reproduces the measured real behaviour rather than inventing one, it is
conformance, not a divergence, so it is not an entry in `differences.md`. Dropping a
message omits it without reordering the per-socket stream, so the FIFO invariant in
[0010](./0010-single-defer-primitive-and-fifo.md) is untouched.

## Alternatives rejected

- **Accept and ignore, so `volatile` always behaves as `emit`.** This delivers a
  volatile emit in the pre-connect window, exactly where a real server drops it, so
  dual-run would no longer compare one behaviour. The measurement is what rules it out:
  the divergence is real, not hypothetical.
- **Do not expose `volatile` at all.** Code that calls `volatile` would fail against
  smocket while running against real socket.io, breaking the substitution the library
  exists for.
