# 0031. Adapters register before admission and may observe whole-socket removal

**Status:** Accepted · 2026-08-13 · #278
**Governed by:** [0008](./0008-adapter-api-before-v1.md),
[0010](./0010-single-defer-primitive-and-fifo.md),
[0018](./0018-delivery-scheduling-adapter-hook.md),
[0025](./0025-built-in-adapter-observation-stays-rooms-only.md)

> **TL;DR** Adapter registration is setup-only and each namespace receives a fresh
> instance. An optional Smocket-only `removeSocket(sid)` signal follows membership
> removal, and `DelayingAdapter` uses it to drain queued delivery in FIFO order.

## Decision

Socket.IO constructs one adapter per namespace and removes whole-socket membership
through its adapter. Smocket keeps the narrower contract from 0008 and 0025 because a
real adapter also owns transport delivery and multi-server behavior that this mock cannot
provide. This record adds only the lifecycle needed by stateful Smocket extensions.

`io.adapter(factory)` must run before the first connection attempt. It prepares a fresh,
distinct adapter for the root and every existing static namespace, then installs all of
them only after every factory call succeeds. Failure leaves the previous registration
unchanged. Future static namespaces and admitted concrete dynamic children each receive
another fresh instance. No membership migration or late replacement exists.

The optional `removeSocket(sid)` method is a whole-socket signal, not Socket.IO's `delAll`
and not an adapter lifecycle event. Cleanup calls `del(sid, room)` for each room, removes
the sid from `adapter.sids`, then calls `removeSocket` once while the socket is still in
the namespace roster. It next clears the socket's live room Set and removes the roster
entry. Rejected and cancelled admission use the same cleanup without connection or
disconnect events. Client, server, Manager-wide, and server-close teardown share it.

Calling `socket.leave(socket.id)` is only a room leave and does not signal removal.
`DelayingAdapter` therefore retains that sid's delay. On actual removal it deletes the
delay, detaches the queue, and delivers every queued item synchronously in FIFO order.
The already-scheduled head later sees that detached queue and does nothing. A reconnect
uses a fresh sid and cannot inherit the removed scheduler state.

This is a narrow follow-up to 0025, not a superseding record. Built-in compatibility
observation remains limited to `rooms`. The shipped Smocket interface still makes `sids`,
`socketsIn`, scheduling, and removal native extension points without claiming arbitrary
Socket.IO Adapter compatibility. The earlier 0018 allowance for delayed delivery after
disconnect is superseded only for whole-socket teardown by this required drain.

## Alternatives rejected

- **Keep cleanup internal.** Stateful adapters could not distinguish a disconnect from a
  room leave and would retain or abandon state.
- **Add upstream `delAll` or lifecycle events.** That would broaden compatibility beyond
  the concrete native need and reopen the surface deferred by 0025.
- **Permit late replacement with migration.** There is no general way to transfer custom
  adapter state atomically, while a setup boundary is explicit and deterministic.
- **Cancel delayed delivery.** Silent cancellation breaks the queued stream and leaves
  acknowledgement behavior dependent on teardown timing.
