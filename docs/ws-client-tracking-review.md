# ws client set review notes

> **TL;DR** server.clients tracks accepted ws sockets when tracking is enabled.
> Membership, sender selection, and text order for each connection are compared
> with real ws. Package application checks remain in #539.

## Implementation choices

Real ws [adds and removes accepted sockets through its clients set](https://github.com/websockets/ws/blob/8.23.0/lib/websocket-server.js).
The runtime creates that public set when clientTracking is omitted or true.
False and explicit undefined leave the property absent, following ws's option spread
and truthiness check. Its close listener removes sockets before user close listeners.

A private socket set remains responsible for internal teardown. Disabling public
tracking does not discard the runtime's ownership of established connections.
Comparisons with tracking disabled keep a connection usable after server.close()
and wait for that connection to close before the server close callback completes.

Text forwarding uses an application handler that iterates server.clients. The
same handler runs with the sender included or excluded. A later marker is forwarded
to every client, including an excluded sender, to bound the observed message list.
The ordering assertions apply separately to each connection.

## Validation limits

[`client-tracking.test.ts`](../test/ws/client-tracking.test.ts) covers the internal
scope in [#582](https://github.com/electrohyun/smocket/issues/582): tracking options,
stable set identity across connections, removal before user close listeners,
forwarding with or without the sender, and consecutive text messages followed by
a marker. It also compares normal server close with tracking disabled.
The [Node forwarding example](../examples/ws-forwarding/) runs the same handler
through ESM and CommonJS in a separate project with the packed package and real ws.
Its later peer marker establishes sender exclusion; mixed payloads and a later
send after one client disconnects check per-client order and membership cleanup.
Payload and failure semantics are described in the [payload](./ws-payloads-review.md)
and [failure](./ws-failure-review.md) reviews; package entry checks belong to
the [package review](./ws-package-review.md).
