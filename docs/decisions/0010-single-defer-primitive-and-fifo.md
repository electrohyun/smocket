# 0010. A single defer primitive keeps per-socket order FIFO

**Status:** Accepted · 2026-07-28 · #67
**Clarified by:** [0034](./0034-packet-middleware-completes-independently.md)

> **TL;DR** Connection completion and every emit are scheduled through one
> `defer` (a `queueMicrotask` wrapper), so each socket observes events in send
> order. The marker proofs rely on it, and it is the premise any delivery
> extension must respect, so it is recorded before the adapter API.

## Decision

Connection completion and every event delivery go through one scheduling
primitive, `defer`, a thin wrapper over `queueMicrotask`. The microtask queue is
itself FIFO, so whatever is scheduled first runs first, and a socket observes its
events in the order they were sent.

This ordering is load-bearing, not incidental. The suite proves a socket did NOT
receive a message by sending it a later marker event and waiting for the marker to
arrive; once the marker lands, anything that was on its way would already have
arrived. That proof holds only if per-socket order is guaranteed, so the
single-primitive rule underwrites the whole test method.

It is also the premise the adapter registration API (0008) builds on. A delay,
drop, or reorder [adapter](../glossary.md#adapter) changes exactly this scheduling
point, so "may an extension break per-socket FIFO, and where" must be answered
here before that API can be designed. The source is the `defer` function in
[`delivery.ts`](../../src/runtime/delivery.ts) and the FIFO-invariant comment beside it.

## Alternatives rejected

- **Schedule connection and emit through separate mechanisms** (say a `setTimeout`
  for connect and a microtask for emits). Two clocks give no ordering guarantee
  between a connect and the first emits, so a `connect` handler could miss an
  event a real client would see.
- **Deliver synchronously.** An emit sent before its handler is registered is then
  lost, and there is no single point where an extension could reason about order.
