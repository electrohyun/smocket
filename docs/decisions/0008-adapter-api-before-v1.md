# 0008. Land the adapter registration API before v1.0.0

**Status:** Accepted · 2026-07-28 · #66

> **TL;DR** We commit to shipping the adapter registration API before v1.0.0.
> Adding an extension point after the release freezes the public surface would be
> a breaking change to the core, and how far such an extension may touch delivery
> order is fixed by 0010.

## Decision

The adapter registration API, the entry point through which a caller supplies a
custom [adapter](../glossary.md#adapter) to change how a broadcast is delivered,
must exist before v1.0.0. v1.0.0 is the release that freezes the public surface
under semver, and opening a new extension point after that surface is frozen adds
to it, which is a breaking change to the core. Introducing the seam before the
freeze keeps it inside the initial contract instead of forcing a later major bump.

The reach of that seam is already bounded. An adapter changes the scheduling point
where delivery is ordered, and [0010](./0010-single-defer-primitive-and-fifo.md)
fixes per-socket FIFO as an invariant the delivery layer must preserve. So how far
an extension may touch delivery order is not an open question: 0010 is the
premise, and this API is shaped to expose the routing decision (which sockets a
broadcast targets) without letting an extension break the per-socket order 0010
guarantees. That boundary has to be settled before the API's shape can be, which
is why 0010 is recorded first.

## Alternatives rejected

- **Add the adapter API in a later minor after v1.0.0.** A new extension point is
  added surface, so introducing it after the freeze is a breaking change to the
  core and forces a major bump. Landing it before the freeze avoids that.
- **Ship v1.0.0 with no adapter seam and never add one.** This pins the routing
  layer to a single in-memory implementation, so the routing decision could never
  be swapped without editing the core, which is the coupling the seam exists to
  prevent.
