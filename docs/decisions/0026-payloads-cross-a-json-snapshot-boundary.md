# 0026. Payloads cross a JSON snapshot boundary

**Status:** Accepted · 2026-08-12 · #237
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0010](./0010-single-defer-primitive-and-fifo.md)

> **TL;DR** Non-binary event and acknowledgement data uses Socket.IO's default-parser JSON
> result and snapshot timing, without parser extensibility, binary encoding, or wire frames.

## Decision

Fresh Socket.IO 4.7.5 and 4.8.3 installs both resolved `socket.io-parser` 4.2.7 and
produced the same result in Node and Chromium. Connected client and server emits encode
synchronously: mutation after `emit` cannot change what arrives. Ack requests follow that
rule, and ack responses snapshot when the receiver calls the ack. A client emit buffered
before connection is the exception: its source stays live until the buffer flushes.

The decoded data follows JSON conversion. A `Date` becomes an ISO string, undefined object
properties disappear, unsupported array positions and non-finite numbers become `null`,
`toJSON` is honored, and custom prototypes become plain objects. Map, Set, RegExp, and
Error retain only enumerable own properties, and repeated references decode as distinct
objects. Circular data and BigInt fail when encoding is attempted:
immediately for a connected send and at flush for a buffered client packet.

A broadcast encodes one packet at the call, including when it has no recipients, and each
recipient decodes an independent object graph. Neither later mutation of the source nor
mutation by one recipient reaches another recipient. Smocket will preserve these results
through direct emits, acknowledgements, broadcasts, timeout wrappers, connected volatile
emits, and buffered delivery in both directions.

Sending-side `onAnyOutgoing` still observes live source values. It precedes a connected
direct emit's snapshot; a buffered client notifies and snapshots only at flush. Its
mutation therefore changes what is encoded. A broadcast snapshots first; each reached
server socket's listener sees the shared source but cannot change the encoded value.

Client delivery modifiers are consumed only after outgoing observation and packet
encoding complete. A reserved-event rejection, an outgoing listener that throws, or a
supported payload encoding failure therefore leaves the modifier armed for the next
completed emit, which consumes it once. Server Socket modifiers keep their existing
earlier consumption boundary, including when their payload encoding fails.

The compatibility contract is the successful decoded value, reference isolation, and
snapshot or failure timing. It does not promise Socket.IO's internal traversal algorithm,
the number of getter or `toJSON` calls, or a native exception's exact class and message.
Those vary below the application result and copying them would couple Smocket to parser
internals rather than the stable boundary.

This decision covers default-parser packets only when they contain no binary value. Binary
encoding and Engine.IO framing remain outside [scope](../scope.md), as do custom parser
options. The implementation must use host-neutral primitives, add no Socket.IO runtime
dependency, pass Node and browser gates, and land separately in [#250].

Under [0019](./0019-what-counts-as-a-breaking-change.md), this newly covered Socket.IO
surface is minor after 1.0 and patch before 1.0. Until #250 lands, direct same-process
references remain a known gap rather than an intentional divergence.

## Alternatives rejected

- **Normalize only `Date`.** Date exposed the defect but not its boundary; it would leave
  prototype loss, aliases, mutation timing, invalid values, and recipient isolation wrong.
- **Keep direct references deliberately.** This changes application-visible values and lets
  a test pass through reference sharing that cannot occur with real Socket.IO.
- **Use `structuredClone`.** It preserves Date, Map, Set, and graph aliases that the default
  parser does not, while accepting and rejecting a different set of inputs.
- **Depend on `socket.io-parser`.** It adds binary and parser machinery outside the selected
  surface and couples a logic-layer mock to upstream transport representation.
