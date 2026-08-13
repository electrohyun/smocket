# 0032. Trace final broadcast routing without payloads

**Status:** Accepted · 2026-08-13 · #262
**Governed by:** [0010](./0010-single-defer-primitive-and-fifo.md),
[0026](./0026-payloads-cross-a-json-snapshot-boundary.md),
[0031](./0031-adapter-registration-and-removal-lifecycle.md)

> **TL;DR** A Smocket adapter may observe one immutable, payload-free snapshot after
> final broadcast recipient selection. `TracingAdapter` records those snapshots and
> can wrap another adapter without changing routing, scheduling, or cleanup.

## Decision

Socket.IO supplies the routing behavior but has no corresponding tracing adapter.
Smocket therefore observes the already verified result without claiming upstream adapter
compatibility. The optional `SmocketAdapter.traceBroadcast(trace)` hook is the single
native observation point.

The core encodes the payload and completes room union, exclusions, roster lookup, and
volatile filtering before calling the hook. Any future recipient filter must run before
it too. A trace is recorded before acknowledgement counting, per-recipient outgoing
catch-all listeners, and delivery. The hook receives no payload or acknowledgement
function, so it cannot retain application data through this API.

Every successful broadcast records once per concrete namespace, including a broadcast
with no recipients. Callback and Promise acknowledgement forms share the same path and
record once. A reserved event or payload-encoding failure records nothing. Direct server
Socket emits and client-to-server emits never enter the broadcast hook.

`BroadcastTrace` contains the event, target rooms, except rooms, their resolved excluded
sids, final recipient sids, and the volatile flag. The object and every array are frozen
snapshots in routing iteration order. Root and named namespaces have separate adapter
instances and therefore separate histories.

`TracingAdapter` stores an unbounded append-only history until `clear()` is called.
`getTraces()` returns a frozen copy, so clearing does not change an earlier result. The
adapter wraps an `Adapter` by default or delegates membership, routing, scheduling, and
whole-socket removal to another `SmocketAdapter`. Wrapping `DelayingAdapter` therefore
records selection immediately while preserving delayed FIFO delivery and cleanup.

## Alternatives rejected

- **Observe `socketsIn` calls.** Empty-room broadcasts bypass that lookup and exclusions
  do not reveal the final recipient set or event.
- **Record payloads.** That would retain application objects and overlap the serialization
  boundary owned by 0026.
- **Trace after delivery begins.** Per-recipient callbacks could observe partial state and
  acknowledgement counting would no longer share one stable snapshot.
- **Add a server event.** Tracing belongs to the existing native adapter extension point
  and must remain isolated by namespace.
