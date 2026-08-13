# 0035. Inherited emitter behavior follows each receiver

**Status:** Accepted, 2026-08-13, #274
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0017](./0017-off-follows-the-emitter.md),
[0019](./0019-what-counts-as-a-breaking-change.md)

> **Summary** Server, Namespace, ParentNamespace, and server Socket expose Node
> EventEmitter behavior. Client Socket keeps component-emitter aliases. Server
> preserves Socket.IO's declared Server return and its runtime root Namespace return.

## Decision

Socket.IO 4.7.5 and 4.8.3 expose the same inherited emitter members. The four server
receivers support `addListener`, `on`, `once`, both prepend forms, both single-removal
forms, bulk removal, listener snapshots, raw wrapper snapshots, counts, event names,
and max-listener state. Smocket accepts that set.

Node receiver mutations return their receiver. `listeners` unwraps `once` callbacks,
`rawListeners` exposes fresh snapshots containing the wrappers, prepend registration
controls dispatch order, and single removal scans from the end. Named callbacks receive
their owning Namespace or Socket as `this`. Node registrations reject a non-function
listener before changing state. `eventNames` follows Node property-key order, with integer
strings before other strings and symbols. A dynamic parent copies only `connect` and
`connection` callbacks into each child, using unwrapped callbacks as Socket.IO does. The
copied callback receives the concrete child Namespace as `this`.

Node identifies an inherited `once` wrapper only through its `.listener` property.
component-emitter identifies its wrapper only through `.fn`. A similarly named property
on an ordinary callback does not make it a wrapper on the other emitter side.

Socket.IO delegates every Server EventEmitter method to the root Namespace. Its
declarations still return Server for fluent methods. Smocket preserves both layers. The
public type returns Server and the runtime returns `io.of('/')`. Listener and max-listener
state read through either object is therefore shared. A delegated listener also receives
the root Namespace, not Server, as `this`.

The inherited `newListener` and `removeListener` notification names collide with
Socket.IO's reserved outgoing event names. Once a `newListener` observer exists, the
next registration throws before adding the requested listener. Once a `removeListener`
observer exists, removal completes and then throws. This is the behavior of both
supported Socket.IO versions on Namespace, ParentNamespace, and server Socket. Server
inherits the Namespace result through delegation. Smocket preserves that error boundary
instead of making the meta-events usable where Socket.IO does not.

Bulk removal of the final `removeListener` observer is not fixed by this decision.
Socket.IO follows a host Node difference where Node 22 throws the reserved-event error
after removal and Node 24 returns normally. Issue #309 tracks the receiver and version
matrix before Smocket chooses behavior for that edge.

Max-listener state defaults to 10 and is local to each Node receiver. Exceeding it emits
`MaxListenersExceededWarning` when the host provides `process.emitWarning`. Browser use
keeps the same state API without inventing a Node warning channel.
A concrete dynamic child keeps its own default instead of inheriting its parent's limit,
so copying enough parent connection callbacks can warn once for that child.

Client Socket keeps component-emitter behavior. `removeListener` is declaration-public.
The source-public `addEventListener` and `removeEventListener` aliases are also accepted.
The add alias is the same function as `on`. All three removal aliases and
`removeAllListeners` are the same function as `off`.

## Alternatives rejected

- **Return Server at runtime from delegated methods.** Socket.IO returns its root
  Namespace in both supported versions.
- **Type delegated Server methods as Namespace.** That would reject applications the
  upstream declarations accept and would hide the actual declaration conflict.
- **Use one emitter model on both socket sides.** It would erase observable wrapper,
  removal, alias, and listener-array differences.
- **Emit browser warnings through `console.warn`.** Socket.IO supplies only Node's warning
  channel here, so a new browser diagnostic would be invented behavior.
