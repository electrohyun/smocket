# 0021. Event maps cross the substitution seam

**Status:** Accepted · 2026-08-10 · #171
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md)

> **TL;DR** Smocket's server and contracts carry Socket.IO's four generic slots, with
> defaults that keep existing untyped calls valid. Server and client directions are
> reversed at their shared socket pair. `ServerSideEvents` preserves the type position;
> it does not add multi-server behavior.

## Decision

`Server`, `ServerContract`, namespaces, sockets, broadcasts, timeout wrappers and volatile
wrappers carry the event maps through every return type. The server order matches
Socket.IO: listen events, emit events, server-side events, then socket data. A paired
client listens to the server's emit map and emits the server's listen map. Socket data
defaults to `any`, as Socket.IO does, and narrows only when the fourth slot is supplied.

`DefaultEventsMap` is exported and accepts every string event. Existing calls that do not
provide maps therefore keep compiling, while a concrete map narrows event names, payloads,
acknowledgements and `socket.data`. The free `connect` and `io` functions stay non-generic,
as Socket.IO's client lookup functions are; an application substitution keeps reading the
real client's own generic `Socket` type.

Server `emitWithAck` accepts only acknowledgement callbacks that carry a response value;
the client keeps Socket.IO client's wider event-name rule. Reserved disconnect listeners
preserve each side's Socket.IO reason and description types.

Socket.IO exports `DefaultEventsMap` from its root but keeps the `EventsMap` constraint on
a blocked internal path. Smocket declares the small constraint locally. Importing it from
`@socket.io/component-emitter` would add a runtime package to express a compile-time rule.

Socket.IO's listener declarations use an internal conditional fallback that cannot be
structurally compared with an equivalent public generic contract. Structural `Ensure`
guards therefore cover the comparable members, while compile-only consumer cases prove
listener inference and reject wrong names, payloads and acknowledgement shapes.

`ServerSideEvents` is present so the generic order survives substitution. Smocket does not
implement `serverSideEmit`; multi-server delivery remains outside the project's scope.

## Alternatives rejected

- **Keep `string` and `unknown[]`.** Runtime substitution would continue to erase an
  application's existing type guarantees at the test boundary.
- **Add generics to `connect` and `io`.** Socket.IO does not expose those type parameters,
  so doing so would invent a second client API rather than preserve one.
- **Import Socket.IO's internal `EventsMap`.** Its package export is blocked, and a deep
  import would make the public declaration depend on an unsupported path.
- **Claim multi-server support from the third slot.** A type parameter has no runtime
  source for Redis or another server and cannot make that behavior exist.
