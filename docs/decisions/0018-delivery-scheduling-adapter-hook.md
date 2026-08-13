# 0018. Per-socket delivery delay is an adapter scheduling hook, keyed by sid, preserving FIFO

**Status:** Accepted · 2026-08-05 · #78
**Governed by:** [0008](./0008-adapter-api-before-v1.md), [0009](./0009-no-raw-websocket-mocking.md), [0010](./0010-single-defer-primitive-and-fifo.md)

> **TL;DR** Per-socket delivery delay is a mock-only test affordance. It rides the
> existing adapter registration API as an optional `scheduleDelivery(sid, deliver)` hook,
> keyed by sid rather than a socket method, and the shipped `DelayingAdapter` delays a
> whole socket's stream through an injectable timer while preserving its send order.

## Decision

Race-condition tests need to interleave events across sockets deterministically, which
means holding back what one socket's client receives. The delay is on the client-inbound
stream (server -> client) only; a socket's server side still receives its client's emits on
the next tick, so a delay never couples the two directions and a delivery keyed by a sid is
one stream, not two. This has no socket.io counterpart, so it is a mock-only affordance like
`server.nextConnection`, recorded in `differences.md` §B, not a conformance behaviour.

It is delivered through the adapter, not a new seam and not a socket method:

- **Registration is the adapter API (0008).** The delay lives in a registered adapter, so
  `io.adapter(() => new DelayingAdapter(timer))` is the whole entry point. There is no
  second registration surface to learn, and the routing adapter and the delaying adapter
  are the same object when a test wants both.
- **Keyed by sid.** The knob is `adapter.setDelay(sid, ms)`, not `socket.delay(ms)`. The
  adapter already speaks in sids (its whole job is `sid -> rooms`), and a test drives a
  socket by its id. Keeping it off the socket instance also keeps the socket surface a
  subset of socket.io's, so the `Ensure<>` guards are untouched.
- **The core routes client-inbound event delivery through the hook.** A client's event
  deliveries funnel through one `send`, which asks the client to schedule its own receipt;
  a socket with no delaying adapter keeps the next-tick `defer` unchanged, so the conformance
  suite is byte-for-byte unaffected. Only when the adapter implements the optional
  `scheduleDelivery(sid, deliver)` does such a delivery take the delayed path. The
  server-inbound stream, acknowledgement answers, and the connect / disconnect lifecycle are
  not routed here: they stay on the next tick, because the delay is for the event stream a
  test interleaves, not a request-response reply or a lifecycle signal.

Order within a socket's stream is preserved, which is what keeps this compatible with
[0010](./0010-single-defer-primitive-and-fifo.md). The shipped `DelayingAdapter` holds a
per-sid high-water fire time: a delivery is scheduled no earlier than the one queued ahead
of it, so lowering a delay never lets a new event overtake one already waiting, and a
uniformly delayed stream stays in send order. Delay changes apply only to deliveries
scheduled after the change.

0010's guarantee shifts in kind but not in effect. It was structural: delivery lived in the
core, out of the adapter's reach. Now a scheduling adapter _could_ reorder a socket's
stream, so per-socket FIFO becomes an obligation on any adapter that schedules, met by the
only one that ships. The default no-hook path is still structurally FIFO, and the routing
adapters from [0008](./0008-adapter-api-before-v1.md) do not schedule at all.

Scheduling goes through an injected `DeliveryTimer` (default: `setTimeout` / `Date.now`),
so a test drives delay with Vitest's fake timers and never waits on the wall clock. Tests
that use it run against the mock target only, built on smocket's `Server` directly rather
than the dual-run fixture, since real socket.io has nothing to compare against.

One consequence follows from delaying only the event stream: a disconnect that follows a
delayed event is itself on the next tick, so the client can observe the disconnect before
that still-pending event. This is a property of using the tool (holding an event past the
teardown that chased it), not a FIFO break within the event stream, and a test that both
delays a socket and disconnects it should account for it.

## Alternatives rejected

- **A separate scheduling seam (`server.scheduler(factory)`).** A second registration API
  parallel to the adapter, for the one capability. It is more general, but the delay is a
  routing-adjacent concern the adapter is already the home for, and a test wanting both
  routing and delay would juggle two registrations of the same socket set.
- **A socket method, `socket.delay(ms)`.** Puts a mock-only member on the socket surface,
  which the socket.io-compatible contract and its `Ensure<>` guards are meant to keep
  clean, and scatters the knob across instances instead of the one sid-keyed place.
- **Real timers with wall-clock waits.** Non-deterministic and slow; a race-condition test
  that sleeps is the flake it is meant to prevent. The injectable timer exists to rule this
  out.
