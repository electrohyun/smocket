# 0037. Keep broadcast management local and canonical

**Status:** Accepted · 2026-08-14 · #265, #322
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md),
[0025](./0025-built-in-adapter-observation-stays-rooms-only.md),
[0036](./0036-drop-final-broadcast-recipients-by-sid.md)

> **TL;DR** Smocket implements local `fetchSockets` and defers deprecated
> `allSockets`. Lookup selects canonical local Sockets; custom routing and delivery
> filters do not redefine that set.

## Decision

Socket.IO 4.7.5 and 4.8.3 behaved alike. `fetchSockets` respected room union and
exclusions and returned the existing local Socket objects. `allSockets` was deprecated
and ignored exclusions in both versions.

Smocket implements `fetchSockets` and defers `allSockets` instead of adding a deprecated
API whose compatibility requires preserving an exclusion quirk. Bulk membership and
disconnect remain tracked by #323 and #324 and are not accepted by this record.

Accepted methods use the namespace roster and each Socket's actual rooms. Target rooms
form an ordered, deduplicated union; exclusion rooms and the sender's id-room are then
removed. A custom `SmocketAdapter.socketsIn` result may change event routing, and a
`DroppingAdapter` may remove final event recipients, but neither changes management.
Timeout, volatile, compression, tracing, and delivery scheduling flags are also ignored.

`fetchSockets` resolves existing local server Socket objects. Its public fetched-socket
type carries the broadcast event map and socket-data generic while promising the stable
Socket.IO subset: identity, handshake, rooms, data, emit, join, leave, and disconnect.
There is no remote-Socket or serialization promise.

This lookup is local-only. Redis adapters, clusters, remote Socket values, and
multi-server coordination remain outside [scope](../scope.md). Adding this newly covered
Socket.IO surface is a minor release after v1 and a patch before v1 under 0019.

## Alternatives rejected

- **Implement `allSockets`.** Deprecation plus its exclusion quirk adds liability without a
  capability `fetchSockets` cannot provide.
- **Route management through the registered adapter.** Smocket adapters are a narrower,
  transport-free delivery seam; making them own lifecycle would reverse 0025.
- **Apply deterministic drops to lookup.** Decision 0036 limits drops to broadcast event
  delivery, not management selection.
- **Return copied Socket views.** The measured local result is the existing Socket object;
  copying would break identity and make mutations diverge.
