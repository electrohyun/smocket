# 0028. `disconnect(true)` closes the shared Manager group

**Status:** Accepted · 2026-08-12 · #236
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0010](./0010-single-defer-primitive-and-fifo.md)

> **TL;DR** Server-side `socket.disconnect(true)` closes every namespace socket on
> the same client Manager, while `false` closes only the current namespace and
> independent Managers stay connected. Smocket models that group without a transport.

## Decision

Socket.IO and socket.io-client 4.7.5 and 4.8.3 produced the same result. Calls for
one origin reuse a cached Manager across distinct namespaces, while a repeated
namespace, `forceNew: true`, or `multiplex: false` creates an independent Manager.
Closing one server socket with `true` disconnected only the namespaces on its
Manager, in their connection order; sockets using the other Managers stayed connected.

Smocket will replace the server-wide identity stand-in with a host-neutral logical
Manager. Its supported lookup surface reuses one cached Manager for distinct
namespaces at an origin, creates an independent Manager for a namespace already in
that cached group, and accepts `forceNew` and `multiplex` to opt out. The Engine.IO
path remains outside this grouping API because Smocket has no transport path.

With `false`, only the addressed namespace socket closes. With `true`, every
connected namespace socket in the same Manager closes in connection order. Each
server socket fires `disconnecting` and then `disconnect`, both with `server
namespace disconnect`, synchronously before the call returns. Their clients then
observe `io server disconnect` through the shared defer boundary in the same order.

Connection-wide here describes an observable namespace lifecycle, not a simulated
transport. Each affected socket performs its ordinary acknowledgement, id, room,
and roster cleanup. The server stays active, other Managers are untouched, and an
affected client reconnects only when application code calls `connect()`.

The implementation is tracked in [#254]. It must preserve the fluent return fixed
separately by [#233]. This newly covered Socket.IO surface is a minor after v1 and
a patch before v1 under [0019](./0019-what-counts-as-a-breaking-change.md).

## Alternatives rejected

- **Ignore `close` because there is no transport.** The transport is absent, but
  which namespace sockets disconnect, their reasons, and their order are observable.
- **Close every client registered on the Smocket server.** One server can host
  several independent Managers, so this would disconnect unrelated clients.
- **Keep the `Server` object as the Manager identity.** It cannot represent repeated
  namespaces or explicit opt-outs without collapsing independent connections.
- **Open a real Engine.IO connection.** The selected behavior needs only an in-memory
  group, while transport and reconnection reproduction remain outside project scope.

[#233]: https://github.com/electrohyun/smocket/issues/233
[#254]: https://github.com/electrohyun/smocket/issues/254
