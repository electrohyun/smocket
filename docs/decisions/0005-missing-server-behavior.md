# 0005. Missing server: connect_error, immediately, no retry, plus a console.error

**Status:** Accepted · 2026-07-28 · #65
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** When no server is registered for the origin, smocket fires
> `connect_error` on the next tick, does not throw, and does not retry, and it
> also logs the failure with `console.error`. Real socket.io retries forever, so
> this is the one place the two deliberately differ.

## Decision

A `connect(url)` whose origin has no registered server fails as one decision with
four faces.

- **Shape: `connect_error`.** The failure surfaces as a `connect_error` event on
  the client, the same event real socket.io uses when a connection cannot be made.
  smocket does not throw, because throwing would invent a failure shape the real
  library does not have, and dual-run holds only if both sides take the same
  failure path.
- **Timing: immediately, no delay.** The `connect_error` fires on the next tick
  through the same `defer` as a successful connect, with no artificial wait before
  it. The shape follows real socket.io's design, but a reconnection delay is not a
  design choice, it is the physics of a network round trip, which a mock has no
  source for. Under 0000, an unobservable delay is not invented, so the failure is
  reported at once.
- **Retry: none.** smocket reports the failure once and stops. Real socket.io
  retries the connection forever, but that retry loop is driven by the same network
  timing the mock cannot reproduce, so smocket does not simulate it.
- **Diagnostics: a parallel `console.error`.** Alongside the event, smocket writes
  the failure to the console. Most apps never attach a `connect_error` handler, so
  an event-only signal would leave a developer who mistyped a url seeing nothing at
  all. The real library does not log this, but that is a diagnostics-tool layer over
  the mock, not a change to the behaviour dual-run compares, so it is not a parity
  violation.

Taken together, this is the single point where smocket deliberately diverges from
real socket.io rather than reproducing it, which is the entry that belongs in
`differences.md`.

## Alternatives rejected

- **Throw synchronously from `connect()`.** A thrown error is a failure shape real
  socket.io never produces here, so tests would have to branch on the target and
  dual-run would no longer compare one behaviour.
- **Simulate the real retry loop.** Retrying forever would need an invented delay
  between attempts, exactly the network timing 0000 forbids inventing, and it would
  hang tests waiting on a server that will never appear.
- **Fire the event only, with no console output.** Correct against the wire
  contract, but it hides the most common real mistake (a wrong or unregistered url)
  from a developer who attached no handler, so the console line is kept.
