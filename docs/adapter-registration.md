# Adapter registration

> **TL;DR** `io.adapter(...)` lets a test supply its own
> [adapter](./glossary.md#adapter), the component that decides which sockets a
> [broadcast](./glossary.md#broadcast) reaches. It exists so the routing layer is
> not pinned to one built-in implementation, and its worth is in the adapters
> built on it. Registration finishes during setup, before any connection attempt.

## Where this comes from

smocket began because a hand-written mock could pair one client but not a second:
it had no [room](./glossary.md#room), broadcast, or
[namespace](./glossary.md#namespace) delivery. smocket is that missing piece, a
mock that routes events the way real socket.io does. That routing core is the body
of the project.

Once routing exists, the next question is whether a test can change it. Two uses
want exactly that:

- An adapter that records every broadcast's targets, so a test can assert who was
  reached.
- An adapter that drops a socket from the target set, so a test can check the app
  survives a message it never receives.

Both need one thing before either can exist: a way to register a custom adapter.
That shared prerequisite is this feature, which is why it comes first rather than
as one more standalone capability.

## What you can and cannot swap

In real socket.io an adapter does two jobs: it holds room membership and it
delivers the event. smocket splits them. The adapter here answers which
[sids](./glossary.md#sid) a broadcast targets, and by default delivery stays in the
core, so per-socket order holds no matter which routing adapter is registered
(see [0010](./decisions/0010-single-defer-primitive-and-fifo.md)).

So a routing adapter can retarget a broadcast, observing or narrowing the set, without
touching delivery. One optional hook goes further: `scheduleDelivery(sid, deliver)` lets
an adapter take over _when_ a socket's client-inbound deliveries fire, which is how the
shipped `DelayingAdapter` delays what a socket's client receives for race-condition tests
(see [0018](./decisions/0018-delivery-scheduling-adapter-hook.md)). It may delay that stream
but never reorder within it: reordering is the one thing the order guarantee forbids, so a
scheduling adapter owes 0010 the obligation to keep each socket's stream in send order.

## Instance and cleanup lifecycle

Call `io.adapter(factory)` before the first connection attempt. The factory receives the
root namespace and every static namespace already created. Later static namespaces and
admitted concrete dynamic namespaces call it when they are created. Every call must return
a fresh instance. If any existing-namespace call throws or reuses an instance, no adapter
is replaced. Adapter state and membership never migrate through late registration.

Stateful adapters may implement `removeSocket(sid)`. Whole-socket cleanup first calls
`del` for each room and removes the `sids` entry, then calls this optional method once while
the namespace roster still contains the socket. Ordinary `socket.leave(socket.id)` does not
call it. This is a Smocket extension hook, not Socket.IO's `delAll` or lifecycle events.

`DelayingAdapter` uses the hook to drain every queued server-to-client delivery in FIFO
order and release the sid's delay state. Scheduled callbacks for that detached queue become
inert. A fresh sid after reconnect starts without the old delay.

## Final routing traces

An adapter may implement `traceBroadcast(trace)` to observe one final routing decision.
The hook runs after payload encoding and recipient selection, including exclusions and
volatile filtering, but before acknowledgement counting, outgoing catch-all listeners, or
delivery. Empty-recipient broadcasts are included. Direct Socket emits are not.

`TracingAdapter` supplies a caller-cleared history of frozen `BroadcastTrace` objects.
Each record contains only the event, target and except rooms, resolved excluded sids,
final recipient sids, and the volatile flag. It retains no payload. Pass another adapter
to its constructor to keep that adapter's routing, scheduling, and removal behavior while
adding traces, including `new TracingAdapter(new DelayingAdapter())`.

## Deterministic broadcast dropping

`DroppingAdapter` removes a known sid from the final broadcast recipients until it is
restored or disconnected. Call `setDropped(sid)` after connection and
`setDropped(sid, false)` to restore it. Unknown and disconnected ids are ignored.

The filter runs after ordinary room, exclusion, sender, and volatile selection but before
tracing, acknowledgement counting, outgoing catch-all listeners, and delivery. It affects
broadcast events only: direct server-Socket emits, client-to-server events, rooms, and
lifecycle are unchanged. Wrap another adapter to combine behaviors, for example
`new TracingAdapter(new DroppingAdapter(new DelayingAdapter()))`.

## Why now, and why smocket-only

The seam lands before v1.0.0 on purpose. That release freezes the public surface,
and adding an extension point after the freeze is a breaking change, so landing it
first is what keeps the routing layer from being pinned to a single in-memory
implementation ([0008](./decisions/0008-adapter-api-before-v1.md)).

> [!IMPORTANT]
> A custom adapter written here does not run on real socket.io, whose adapter also
> delivers and needs a transport smocket has none of
> ([0009](./decisions/0009-no-raw-websocket-mocking.md)). smocket guarantees its own
> delivery matches real socket.io; it does not promise your extension code is portable.

That boundary is listed in [differences.md](./differences.md) §B and
[0031](./decisions/0031-adapter-registration-and-removal-lifecycle.md). Final routing
observation is recorded in [0032](./decisions/0032-trace-final-broadcast-routing.md).
Deterministic final-recipient dropping is recorded in
[0036](./decisions/0036-drop-final-broadcast-recipients-by-sid.md).
