# 0029. Parent broadcast conformance stops before narrowing

**Status:** Accepted · 2026-08-12 · #269 · Revised 2026-09-30 · #519
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md)

> **TL;DR** Direct dynamic parent broadcasts remain conformance. Narrowed delivery
> stays outside the claim pending dedicated coverage. The former version-disagreement
> rationale is retracted: current pinned 4.8.3 and 4.8.4 installs route the measured case.

## Decision

Socket.IO 4.7.5 and 4.8.3 agree that a direct parent `emit` reaches the current
concrete child [namespaces](../glossary.md#namespace), while each child keeps its
own rooms, adapter, sockets, and lifecycle. Smocket will reproduce and publish
that common behavior together with concrete-child routing.

The original record said that 4.7.5 routed `parent.to(room).emit(...)`, while
4.8.3 threw a `TypeError` because its child collection was not wired into the
narrowed adapter. That version-disagreement claim is retracted for the current
pinned installations; it is retained here as the history of the exclusion.

On 2026-09-30, paired 4.8.3 and 4.8.4 server/client installs with the default
in-memory adapter both delivered a narrowed room broadcast to an admitted child.
The child socket joined the room; the client recorded the direct and narrowed
events before acknowledging a later marker sent by that child socket. Neither
reference threw. Both resolved `socket.io-adapter` 2.5.8.

Under [0043](./0043-follow-one-declared-socketio-target.md), new conformance uses
the declared 4.8.4 target rather than agreement across minors. This issue retains
the existing support boundary: the measured narrowed case does not establish the
full routing matrix. Dedicated coverage must precede publishing narrowed delivery
as supported. Smocket does not reproduce the historically recorded `TypeError`.

This boundary is about the parent operation only. Room routing on every concrete
child remains ordinary conformance. Under [0019], adding the common dynamic
parent surface is a minor after v1 and a patch before v1.

## Alternatives rejected

- **Reproduce the 4.8.3 `TypeError`.** Original rationale (retracted): one supported
  version does not throw, and encoding an adapter wiring defect would make the mock
  less useful without a stable fidelity source. Current measurements do not throw.
- **Select the 4.7.5 narrowed routing result now.** Original rationale (retracted):
  it is coherent, but publishing it would overstate agreement across versions.
  The remaining reason to defer is dedicated coverage, rather than version disagreement.
- **Exclude all parent broadcasts.** Direct parent broadcast behavior agrees and
  is observable, so excluding it would leave verified surface unimplemented.
