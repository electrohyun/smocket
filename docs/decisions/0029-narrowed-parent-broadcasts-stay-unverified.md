# 0029. Parent broadcast conformance stops before narrowing

**Status:** Accepted · 2026-08-12 · #269
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md)

> **TL;DR** Dynamic parent behavior shared by Socket.IO 4.7.5 and 4.8.3 is
> conformance, including direct parent broadcasts. Narrowed parent broadcasts
> remain outside that claim because the supported versions disagree; Smocket
> does not reproduce the 4.8.3 `TypeError`.

## Decision

Socket.IO 4.7.5 and 4.8.3 agree that a direct parent `emit` reaches the current
concrete child [namespaces](../glossary.md#namespace), while each child keeps its
own rooms, adapter, sockets, and lifecycle. Smocket will reproduce and publish
that common behavior together with concrete-child routing.

The supported versions disagree after a parent broadcast is narrowed. In 4.7.5,
`parent.to(room).emit(...)` routes across matching children. In 4.8.3, the
released in-memory parent adapter throws a `TypeError` because its child
collection is not wired into the narrowed broadcast adapter.

Smocket will not reproduce that `TypeError`: it is not common supported-version
behavior and does not describe a useful delivery rule. Smocket also will not
select the 4.7.5 result as conformance while 4.8.3 disagrees. Narrowed parent
broadcasts therefore stay outside the published conformance claim until the
supported real versions converge or a later decision intentionally selects a
result.

This boundary is about the parent operation only. Room routing on every concrete
child remains ordinary conformance. Under [0019], adding the common dynamic
parent surface is a minor after v1 and a patch before v1.

## Alternatives rejected

- **Reproduce the 4.8.3 `TypeError`.** One supported version does not throw, and
  encoding an adapter wiring defect would make the mock less useful without a
  stable fidelity source.
- **Select the 4.7.5 narrowed routing result now.** It is coherent, but publishing
  it as conformance would overstate agreement across the supported versions.
- **Exclude all parent broadcasts.** Direct parent broadcast behavior agrees and
  is observable, so excluding it would leave verified surface unimplemented.
