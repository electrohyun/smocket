# 0007. Enable noUncheckedIndexedAccess for the delivery-layer lookups

**Status:** Accepted · 2026-07-28 · #66

> **TL;DR** We enable `noUncheckedIndexedAccess`. Room and sid lookups return
> `Set | undefined`, so the compiler catches the delivery layer's specific
> failure mode. This is a targeted safety rule for the map lookups, not a move
> toward general type strictness.

## Decision

We turn on `noUncheckedIndexedAccess`. The delivery layer resolves a broadcast by
looking a [room](../glossary.md#room) up in the membership map and a
[sid](../glossary.md#sid) up in the socket registry, and both lookups return
`Set | undefined`: a room with no members, or an unknown sid, is `undefined`, not
an empty set. Without the flag the compiler types these lookups as always
present, so iterating a missing room type-checks and then throws at runtime.

The value here is narrow and deliberate. This is not a push for broad strictness
across the codebase; it is that the one operation the whole project exists to get
right, deciding which sockets receive an event, is exactly an indexed map lookup
that can miss. With the flag on, the compiler forces the `undefined` case to be
handled at the delivery seam, which is the project's most likely implementation
mistake.

## Alternatives rejected

- **Leave the flag off and guard each lookup by hand.** This relies on every
  author remembering the missing-room case at every lookup site. The flag makes
  the compiler enforce it once instead of trusting recall at each call.
- **Adopt the full family of strict index and optionality flags.** That is
  broader than the problem, and the cost lands on code with nothing to do with
  delivery. This decision wants only the check that guards the map lookups, so it
  enables that one flag and no more.
