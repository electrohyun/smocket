# 0036. Drop final broadcast recipients by sid

**Status:** Accepted · 2026-08-14 · #263
**Governed by:** [0010](./0010-single-defer-primitive-and-fifo.md),
[0031](./0031-adapter-registration-and-removal-lifecycle.md),
[0032](./0032-trace-final-broadcast-routing.md)

> **TL;DR** `DroppingAdapter` deterministically removes known sids after normal
> broadcast routing and volatile filtering. It changes event delivery and new
> acknowledgement collection only, then clears each sid on whole-socket removal.

## Decision

Socket.IO has no built-in deterministic recipient-dropping adapter. Smocket adds one
test-only routing affordance through the existing adapter seam without changing default
Socket.IO-compatible delivery.

`setDropped(sid, dropped = true)` toggles a currently known namespace sid and
`isDropped(sid)` observes that state. Unknown and removed sids are no-ops. The core first
completes room union, exclusions, sender exclusion, roster lookup, and volatile
pre-connect filtering, then gives an optional adapter hook the ordered final ids. The
hook may only narrow: additions, duplicates, and reordering do not affect core order.

A dropped sid receives no broadcast event, contributes no new acknowledgement, and has
no outgoing catch-all observation for that delivery. Direct server-Socket emits,
client-to-server events, rooms, lifecycle, and acknowledgements already in flight remain
unchanged. Removing every recipient uses the existing empty-recipient collector result.

Whole-socket removal clears drop state through the 0031 lifecycle hook. Each namespace
has its own adapter, and reconnect creates a fresh sid, so neither path inherits a drop.
The adapter wraps another adapter and forwards membership, scheduling, tracing, and
cleanup. `TracingAdapter` also forwards narrowing, so either wrapper order records the
post-drop final recipients while `DelayingAdapter` keeps retained-recipient FIFO.

## Alternatives rejected

- **Override `socketsIn`.** Exclusion lookup and empty-room broadcasts make that unsafe.
- **Random or next-N loss.** Probability, seed, and sequence semantics are separate work.
- **Drop direct Socket delivery.** The use case is final broadcast routing, not a general
  transport failure model.
- **Let filters add or reorder recipients.** That would reopen routing and FIFO contracts
  instead of providing deterministic narrowing.
