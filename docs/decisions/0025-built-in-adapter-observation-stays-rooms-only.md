# 0025. Built-in Adapter observation stays rooms-only

**Status:** Accepted · 2026-08-12 · #238
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0008](./0008-adapter-api-before-v1.md), [0013](./0013-reconnect-fresh-socket.md),
[0018](./0018-delivery-scheduling-adapter-hook.md)

> **TL;DR** Smocket stabilizes the built-in adapter's live `rooms` map for observation. The
> other methods and events lack a core use and conflict with teardown or custom-adapter
> boundaries, so they stay outside the v1 compatibility surface.

## Decision

Fresh Socket.IO 4.7.5 and 4.8.3 installs both resolved `socket.io-adapter` 2.5.8.
Runtime probes found the same behavior in both: `addAll` processes a `Set` in insertion
order, emits `create-room` before adding the first member, then emits `join-room` after
adding it, and emits nothing for duplicate membership. Removal emits `leave-room` after
removing the member and `delete-room` after removing an empty room key. During `delAll`,
those pairs follow the socket's room insertion order while its `sids` entry remains intact
until every room is removed. `disconnecting` precedes these removals and `disconnect`
follows them.

`socketRooms` returns the same live Set while connected and `undefined` after teardown;
`sockets` returns the sids present in both `sids` and the namespace socket roster for an
empty Set, and a deduplicated room union otherwise. The declarations expose `addAll` as
`void | Promise<void>`, `delAll` as `void`,
`socketRooms` as `Set | undefined`, and `sockets` as `Promise<Set>`. The events inherit
Node `EventEmitter`'s untyped string-and-`any[]` surface, so their names and payloads are
not encoded in the declarations.

Smocket keeps only `namespace.adapter.rooms` as built-in Adapter compatibility surface.
Its live membership and removal of empty room keys are already needed to inspect routing
state. External mutation of the map is not supported. Every new candidate is deferred:

| Candidate                                               | Decision | Reason                                                                                                                                                                               |
| ------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `addAll`, `delAll`                                      | Defer    | `socket.join`, `socket.leave`, and disconnect already own membership changes; direct mutation would add a second lifecycle entry point.                                              |
| `socketRooms`                                           | Defer    | `socket.rooms` already supplies the application observation, and exact live-reference teardown conflicts with 0013.                                                                  |
| `sockets`                                               | Defer    | Smocket's core already routes through its Smocket-only `socketsIn`; no application or extension use requires the upstream async lookup contract.                                     |
| `create-room`, `join-room`, `leave-room`, `delete-room` | Defer    | No concrete consumer requires them, while promising `on` would widen the separate `SmocketAdapter` registration contract or make `namespace.adapter` inconsistent after replacement. |

The teardown conflict is observable. While connected, real `socket.rooms` is the same Set
returned by `adapter.socketRooms(id)`. After disconnect, the getter returns a new empty Set,
but a reference captured before disconnect retains every old room. Decision 0013 instead
requires that captured Smocket reference to be emptied in place. This decision does not
silently reverse 0013; a future `socketRooms` proposal must first revisit it explicitly.

The exported `Adapter` and `SmocketAdapter` keep `add`, `del`, `sids`, `socketsIn`, and the
optional scheduling hook as Smocket-only surface under 0008 and 0018. They remain
incompatible with arbitrary Socket.IO adapters. `DelayingAdapter` keeps the same membership
and delivery behavior, with no lifecycle event routed through its delay queue. No deferred
member blocks v1; a concrete use case may reopen one under 0019.

## Alternatives rejected

- **Accept every matching name before v1.** Name parity alone does not justify eight new
  behavioral promises, including intermediate map state, reference identity, and event order.
- **Accept only lookups and lifecycle events now.** `socketRooms` still reaches the 0013
  conflict, and events still change what every registered custom adapter must provide.
- **Make `SmocketAdapter` match Socket.IO's Adapter.** A real adapter also owns transport
  delivery and multi-server behavior that Smocket cannot reproduce; 0008 and 0018 already
  assign this seam a narrower routing and test-scheduling role.
