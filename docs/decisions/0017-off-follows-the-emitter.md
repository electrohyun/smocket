# 0017. off follows the underlying emitter: Node on the server, component-emitter on the client

**Status:** Accepted · 2026-08-04 · #103
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** socket.io's server socket is Node's `EventEmitter` and its client is
> component-emitter, so their `off` differs. smocket reproduces both: the server
> requires a listener and `off(event)` throws, while the client's no-listener forms clear.

## Decision

Measured against real socket.io 4.8.3, `off` splits by side because the two sockets
are built on different emitters.

On the server socket (Node's `EventEmitter`, whose `off` is `removeListener`) a
listener is required: `off(event)` with none throws a `TypeError`, so bulk removal is
`removeAllListeners`. On the client socket (component-emitter) the no-listener forms
do not throw: `off()` clears every listener, `off(event)` clears that event, and
`off(event, listener)` removes one. smocket exposes each side's shape, and the client
contract widens `off` to match rather than forcing the server's stricter signature on
it.

Two behaviours are shared and were also measured. `off(listener)` removes a
registration made through `once`, because the wrapper carries the original listener
and both sides compare against it; smocket does the same and removes the first match
only. A catch-all (`onAny`) survives `removeAllListeners()`, because it is kept in a
separate store, on the real side and here.

Because this reproduces the measured real behaviour of both emitters rather than
inventing one, it is conformance, not a divergence, so it is not an entry in
`differences.md`. It is recorded here because it reverses the `off(event)` bulk form
the issue proposed, and because the server/client split is not obvious from the API.
The emitter methods return `void` rather than the socket, consistent with `on` and
`once`, so chaining is not part of smocket's surface: a deliberate simplification, not
a measured behaviour.

## Alternatives rejected

- **One uniform `off` on both sides.** Whichever emitter it copied, it would diverge
  from the other real socket, so a test could not compare one behaviour across the two
  sides.
- **`off(event)` as a bulk remove on the server too, as the issue first proposed.** A
  real server socket throws there rather than clearing, so reproducing a bulk remove
  would invent a behaviour the server does not have.
