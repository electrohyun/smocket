# 0037. Keep broadcast management local and canonical

**Status:** Accepted · 2026-08-14 · #265, #322, #323, #324
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md),
[0025](./0025-built-in-adapter-observation-stays-rooms-only.md),
[0028](./0028-disconnect-true-closes-the-shared-manager-group.md),
[0036](./0036-drop-final-broadcast-recipients-by-sid.md)

> **TL;DR** Smocket implements local `fetchSockets`, `socketsJoin`, and
> `socketsLeave`, and `disconnectSockets`, while deferring deprecated `allSockets`.
> Management selects canonical local Sockets; delivery adapters do not redefine the set.

## Decision

Socket.IO 4.7.5 and 4.8.3 behaved alike. `fetchSockets` respected room union and
exclusions and returned the existing local Socket objects. Bulk join and leave mutated
the selected sockets synchronously. `disconnectSockets(false)` stayed in the selected
namespace, while `true` closed every namespace Socket sharing a selected Socket's
Manager. Every bulk method returned `undefined`. `allSockets` was deprecated and ignored
exclusions in both versions.

Smocket implements `fetchSockets`, `socketsJoin`, `socketsLeave`, and both forms of
`disconnectSockets`. It defers `allSockets` instead of adding a deprecated API whose
compatibility requires preserving an exclusion quirk.

Accepted methods use the namespace roster and each Socket's actual rooms. Target rooms
form an ordered, deduplicated union; exclusion rooms and the sender's id-room are then
removed. A custom `SmocketAdapter.socketsIn` result may change event routing, and a
`DroppingAdapter` may remove final event recipients, but neither changes management.
Timeout, volatile, compression, tracing, and delivery scheduling flags are also ignored.

`fetchSockets` resolves existing local server Socket objects. Its public fetched-socket
type carries the broadcast event map and socket-data generic while promising the stable
Socket.IO subset: identity, handshake, rooms, data, emit, join, leave, and disconnect.
There is no remote-Socket or serialization promise.

Bulk membership snapshots the selected Sockets, then delegates to their existing join or
leave primitive. Mutating a room used for selection therefore still reaches every Socket
in the original set, and each call returns `undefined` synchronously.

Bulk disconnect also snapshots selection. `false` delegates namespace-local teardown;
`true` delegates Manager teardown from 0028, including unselected namespace siblings and
pending admission. Existing lifecycle guards keep each affected Socket single-shot.

These operations are local-only. Redis adapters, clusters, remote Socket values, and
multi-server coordination remain outside [scope](../scope.md). Adding this newly covered
Socket.IO surface is a minor release after v1 and a patch before v1 under 0019.

## Alternatives rejected

- **Implement `allSockets`.** Deprecation plus its exclusion quirk adds liability without a
  capability `fetchSockets` cannot provide.
- **Route management through the registered adapter.** Smocket adapters are a narrower,
  transport-free delivery seam; making them own membership or lifecycle would reverse 0025.
- **Apply deterministic drops to management.** Decision 0036 limits drops to broadcast
  event delivery, not management selection.
- **Return copied Socket views.** The measured local result is the existing Socket object;
  copying would break identity and make mutations diverge.
