# 0006. The handshake carries only the fields a mock has a source for

**Status:** Accepted · 2026-07-28 · #65
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** smocket populates the [handshake](../glossary.md#handshake) fields it
> can derive from the connection itself: `query`, `auth`, `time`, `issued`, and
> `url`. The network-layer fields, `headers`, `address`, `xdomain`, and `secure`,
> have no source in a mock, so smocket leaves them rather than guess.

## Decision

`socket.handshake` is populated selectively. This is the first concrete
application of 0000: a field is filled when its value has a source in what smocket
actually knows about the connection, and left otherwise.

The filled fields all come from the connection smocket sets up in memory.

- **`query`** and **`auth`** are the client's own inputs, passed to `connect()`
  and carried straight through, so their source is the caller.
- **`time`** and **`issued`** are the connection's timestamp, which smocket
  produces at the moment it completes the pairing, so it can supply them exactly.
- **`url`** is the normalized origin the client connected to, which smocket already
  holds as the registry key, so it is available with no invention.

`query` has two caller sources, the url's own query string and the options argument
of `connect(url, opts)`. When both are present the url wins and the options query is
dropped wholesale; the options query is used only when the url carries none. This is
not the intuitive rule, explicit options winning, so it was measured against
socket.io-client 4.x rather than assumed: the real client uses the url query and
ignores `opts.query` whole, and smocket matches, so a handler reads the same
`handshake.query` on either engine.

The unfilled fields all describe a transport smocket does not have.

- **`headers`** and **`address`** are properties of a real HTTP request and a real
  remote peer. There is no request and no socket address in an in-memory pairing,
  so any value would be invented.
- **`xdomain`** and **`secure`** describe cross-origin and TLS state of a real
  network connection. A mock has neither a wire nor a certificate to read them
  from, so under 0000 they are left rather than defaulted to a plausible boolean.

The split follows a single line: what the caller and the mock's own bookkeeping
supply is real and gets filled; what only a live network connection could answer
has no source and is left.

## Alternatives rejected

- **Fill every field with a plausible default** (empty `headers`, `127.0.0.1` for
  `address`, `false` for `xdomain` and `secure`). Each default reads as fact once
  in the object, and a test could come to depend on a value smocket made up, which
  is exactly the drift 0000 exists to prevent.
- **Fill nothing and expose an empty handshake.** This discards `query`, `auth`,
  and `url`, which do have a real source and which handlers legitimately read, so
  it throws away verifiable information to avoid inventing the rest.
