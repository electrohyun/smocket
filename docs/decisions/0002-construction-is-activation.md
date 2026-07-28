# 0002. Constructing the Server is activation; there is no start()

**Status:** Accepted · 2026-07-28 · #64
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** `new Server(url)` is activation on its own: the entry module exports the
> constructed server and there is no separate `start()` to call. Adding one would
> signal setup work smocket does not do, so the plain constructor is the whole API.

## Decision

Constructing the server activates it. There is no second `start()` step, and the
entry module exports the constructed server so a test imports it and uses it at
once. This is option A. The reasoning starts from real socket.io, where building
the server is what brings it up, with no build-then-start split; smocket keeps that
shape.

A `start()` would also have nothing to do. MSW (Mock Service Worker, a
request-mocking library) needs `start()` because it installs request interceptors;
smocket switches nothing on, so its `start()` could only be a one-line
`started = true` flag. A method whose whole body is a flag tells the reader the
library does setup it does not do, so it is left out.

## Alternatives rejected

- **An empty `start()` procedure (option B).** A no-op kept only for API symmetry.
  Rejected for the reason above: it signals setup that never happens.
- **Import side effect only, no export (option C).** The module would activate the
  server as a side effect of being imported and export nothing, saving the one line
  that names it. It is rejected not as risky but on cost: option A already gives C's
  benefit (importing the entry activates the server) for the price of one `export`
  word, while C's saved line costs the server being pulled into any production
  bundle that imports the module. Wrapping the activation in a conditional dynamic
  import to keep it out of production just rebuilds option A.
  - Retracted reasons: ~~C has a fragile load order~~ and ~~C is untestable~~ were
    the first two arguments raised against C. Both were later found false, and they
    are struck through rather than deleted, because this project marks a wrong
    rejection reason as retracted and keeps it on the record.
