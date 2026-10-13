# Basic ws runtime review notes

> **TL;DR** The internal ws runtime models server registration, asynchronous
> connection, text delivery, and normal close. Real-ws comparison and mock-specific
> isolation checks establish separate guarantees; package binding belongs to #562.

## Implementation choices

[`runtime.ts`](../src/ws/runtime.ts) reuses NodeEmitter only for ordinary listener
bookkeeping. Its socket pairing, message delivery, and close state belong to ws.
[`registry.ts`](../src/ws/registry.ts) owns a separate virtual host/port registry,
so Socket.IO origins and namespace interpretation do not participate in ws lookup.
Shared-core extraction remains [#541](https://github.com/electrohyun/smocket/issues/541).

[`emitter.ts`](../src/ws/emitter.ts) preserves the Node registration/removal aliases
and distinguishes omitted bulk-removal arguments from explicit undefined. Node
unwraps a sole once callback in removal notifications; with multiple listeners,
it reports the argument passed to removeListener, which can be the raw wrapper.
These adaptations stay in ws because Socket.IO handles those notification names
through its own reserved-event rules in [0035](./decisions/0035-inherited-emitter-follows-each-receiver.md).

Connection, open, and delivery callbacks use microtasks. The real-ws tests pin
asynchronous connection and the ordering of an immediate server greeting after open.
They do not establish the same scheduling phase relative to unrelated Node I/O.
Text and close reasons use Node Buffer directly; no caller-supplied Buffer provider
is needed. Address matching follows [0044](./decisions/0044-ws-api-without-transport.md).

The constructor callback receives a separate address() receiver. Request headers
contain application-visible basic upgrade fields, including a fresh random key,
without creating an HTTP server or encoding a WebSocket frame.

## Review limits

[`basic.test.ts`](../test/ws/basic.test.ts) runs the same application code against
real ws and the mock. [`isolation.test.ts`](../test/ws/isolation.test.ts) separately
checks network-free operation, virtual host selection, aliases, and path rejection.
Virtual host checks are not claims about real DNS or host-network configuration.

[`emitter.test.ts`](../test/ws/emitter.test.ts) compares the selected EventEmitter
methods on the server, client socket, and accepted socket. Its typed error-event
comparison covers Error objects, not Node's formatting of arbitrary unhandled values.
[`emitter.typecheck.ts`](../test/ws/emitter.typecheck.ts) checks the actual runtime's
callback receivers, event arguments, aliases, and raw-wrapper typing.

Both constructors must structurally satisfy the test adapter's exercised subset,
without type assertions. Request fixture types keep Node's optional url/method,
while runtime assertions pin their values. This does not establish the complete
public contract or provide a production package entry.
Binding must account for every selected method before [#562](https://github.com/electrohyun/smocket/issues/562)
can validate the actual package.

The [event listener review notes](./ws-event-listeners-review.md) explain event
properties, listener identity, event values, and their comparison limits.

The [input validation review notes](./ws-input-validation-review.md) explain URL
normalization, URL snapshots, close arguments, and state-dependent validation.
Public client tracking and broadcast belong to [#539](https://github.com/electrohyun/smocket/issues/539).
The failure and abrupt-close paths support teardown, but their detailed ordering,
send callbacks, concurrent close, pending work, and byte inputs require the
real-ws comparisons in [#540](https://github.com/electrohyun/smocket/issues/540).
