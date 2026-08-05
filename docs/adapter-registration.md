# Adapter registration

> **TL;DR** `io.adapter(...)` lets a test supply its own
> [adapter](./glossary.md#adapter), the component that decides which sockets a
> [broadcast](./glossary.md#broadcast) reaches. It exists so the routing layer is
> not pinned to one built-in implementation, and its worth is in the adapters
> built on it, not in the registration call alone.

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

## Why now, and why smocket-only

The seam lands before v1.0.0 on purpose. That release freezes the public surface,
and adding an extension point after the freeze is a breaking change, so landing it
first is what keeps the routing layer from being pinned to a single in-memory
implementation ([0008](./decisions/0008-adapter-api-before-v1.md)).

A custom adapter written here does not run on real socket.io, whose adapter also
delivers and needs a transport smocket has none of
([0009](./decisions/0009-no-raw-websocket-mocking.md)). smocket guarantees its own
delivery matches real socket.io; it does not promise your extension code is
portable. That boundary is listed in [differences.md](./differences.md) §B.
