# Differences from real socket.io

> **TL;DR** The short list of where smocket and real socket.io do not line up: the
> places smocket deliberately diverges (section A) and the API smocket adds that
> socket.io has no equivalent for (section B). Each entry links to the decision
> that explains it; the reasoning lives there, not here.

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

## B. What smocket adds that socket.io has no equivalent for

- **`server.nextConnection(namespace)`.** Not a socket.io API. It resolves with the
  next server-side socket to connect, which the test harness needs to pair a
  connect with its server side. Real socket.io exposes no counterpart, so this is
  the first asymmetry a user meets, and it is listed here rather than left to be
  discovered.
- **`io.adapter(factory)` registers a targeting-only adapter.** socket.io has
  `io.adapter(...)` too, but its adapter also delivers and needs a transport smocket
  lacks, so the two are not signature-compatible: a custom adapter written for
  smocket does not run on real socket.io. smocket's adapter changes the routing
  decision (which sockets a broadcast targets) only; delivery stays in the core.
  See [adapter-registration.md](./adapter-registration.md) and
  [0008](./decisions/0008-adapter-api-before-v1.md).
