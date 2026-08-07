# Differences from real socket.io

> **TL;DR** The short list of where smocket and real socket.io do not line up: the
> places smocket deliberately diverges (section A) and the API smocket adds that
> socket.io has no equivalent for (section B). Each entry links to the decision
> that explains it; the reasoning lives there, not here.

This page exists because of how much else matches. A mock that answers correctly almost
everywhere gives a reader no reason to keep checking, and the reader who has stopped
checking is the one a divergence reaches. The closer the fidelity gets, the more the
remaining gaps depend on being written down. What to keep doubting is read here rather
than discovered in a failing suite.

## A. Where smocket deliberately differs

- **No retry when the server is absent.** Real socket.io retries a failed
  connection forever; smocket reports the failure once and stops. This is the one
  intentional behavioural divergence.
  See [0005](./decisions/0005-missing-server-behavior.md).
- **A `console.error` alongside `connect_error`.** smocket logs a missing-server
  failure to the console; real socket.io does not.
  See [0005](./decisions/0005-missing-server-behavior.md).
- **No delay before reporting an absent server.** smocket fires `connect_error` on
  the next tick with no network wait, because a round-trip delay has no source in a
  mock. See [0005](./decisions/0005-missing-server-behavior.md).
- **Handshake `headers`, `address`, `xdomain`, and `secure` are left unset.** These
  describe a real transport a mock does not have, so smocket leaves them rather
  than invent values. See [0006](./decisions/0006-handshake-fields.md).
- **`handshake.query` fidelity is scalar-only.** smocket stringifies each query value
  the way a real querystring does (`{ room: 1 }` -> `{ room: '1' }`), matching real
  socket.io for scalar values. Array or object query values are coerced with
  `String(...)` and are not guaranteed to match real socket.io's encoding: that edge
  has no measured reference, so smocket does not invent one.
  See [0006](./decisions/0006-handshake-fields.md).
- **`emit` and `on` return nothing.** socket.io returns the socket from
  `socket.emit(...)`, `socket.on(...)`, and `socket.once(...)`, so the calls chain, and
  `Server#emit` and a broadcast operator's `emit` return `true`. Every one of these returns
  `undefined` in smocket, so `socket.on('a', f).on('b', g)` throws and a caller that reads
  the result sees a falsy value where socket.io gives a truthy one. Unlike the entries above
  this is not a decision, it is a gap, found by using the package from outside and recorded
  here until it is corrected. No decision record covers it.

## B. What smocket adds that socket.io has no equivalent for

- **`server.nextConnection(namespace)`.** Not a socket.io API. It resolves with the
  next server-side socket to connect, which the test harness needs to pair a
  connect with its server side. Real socket.io exposes no counterpart, so this is
  the first asymmetry a user meets, and it is listed here rather than left to be
  discovered.
- **`io.adapter(factory)` registers a smocket adapter.** socket.io has
  `io.adapter(...)` too, but its adapter also delivers and needs a transport smocket
  lacks, so the two are not signature-compatible: a custom adapter written for
  smocket does not run on real socket.io. A smocket adapter changes the routing
  decision (which sockets a broadcast targets); delivery stays in the core unless the
  adapter opts into the optional `scheduleDelivery(sid, deliver)` hook (see the delay
  affordance below and [0018](./decisions/0018-delivery-scheduling-adapter-hook.md)).
  See [adapter-registration.md](./adapter-registration.md) and
  [0008](./decisions/0008-adapter-api-before-v1.md).
- **`DelayingAdapter` delays what a socket's client receives, by sid.** Not a socket.io API.
  It rides the adapter registration above to hold a socket's client-inbound stream
  (server -> client) by a per-sid amount, so a race-condition test can interleave events
  across sockets deterministically; the server side still receives its client's emits on the
  next tick. Order within the delayed stream is preserved, and scheduling runs through an
  injectable timer so a test drives it with fake timers rather than the wall clock. See
  [0018](./decisions/0018-delivery-scheduling-adapter-hook.md).
