# 0011. Socket ids match socket.io's shape, not its source

**Status:** Accepted · 2026-07-28 · #67

> **TL;DR** A socket id is a 20-character url-safe base64 string, the same shape
> real socket.io emits. smocket copies the shape, not how socket.io generates it,
> because a real-looking opaque id keeps ids out of test assertions.

## Decision

Each socket's id ([sid](../glossary.md#sid)) is a 20-character url-safe base64
string, produced by `newId` in
[`delivery.ts`](../../src/runtime/delivery.ts) from 15 random bytes. The goal is
to match the shape of a real socket.io id, not to reproduce socket.io's own
id-generation internals, which are not observable and have no bearing on delivery.

A real-looking, opaque id also protects the tests. A predictable id invites test
code to depend on it, and an id baked into a snapshot or a log assertion makes
that test brittle the moment id generation changes. An opaque random id offers
nothing to depend on, so tests assert on delivery behaviour instead.

This also closes an id-format question that was left open earlier. A resolved
decision that is not written down tends to reopen, so it is recorded here.

## Alternatives rejected

- **Sequential ids** (`socket-1`, `socket-2`). Readable, but they invite tests to
  hard-code them and end up pinned in snapshots and logs, which is exactly the
  fragility to avoid.
- **Reproduce socket.io's id source.** No observable benefit, and it couples
  smocket to an internal detail that delivery never depends on.
