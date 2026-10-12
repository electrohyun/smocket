# 0044. Support ws application APIs without transport

**Status:** Accepted · 2026-10-09 · #553, #555
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md)
**Supersedes:** [0009](./0009-no-raw-websocket-mocking.md)

> **TL;DR** Support selected ws application calls, events, and states in memory through
> smocket/ws, following real ws within the agreed scope. This does not intercept network
> traffic or reproduce transport; existing Socket.IO APIs and behavior remain unchanged.

## Decision

Real [ws](https://github.com/websockets/ws/blob/8.21.3/lib/websocket-server.js) creates an
HTTP server for its port-based constructor and supplies an accepted WebSocket and request
to connection handlers. Those application-visible calls and values can be reproduced
without creating HTTP/TCP connections. That permits ws applications to use a mock while
preserving the transport exclusions behind 0009.

Use default WebSocket and named WebSocketServer imports from `smocket/ws`. CommonJS
receives the WebSocket constructor directly, with WebSocketServer as a property.
Do not require a public environment factory or manual Buffer injection. The ws byte path
targets Node Buffer; its types must not impose Node declarations on other smocket users.
Native browser WebSocket and Blob are outside this selected ws contract.

Use small structures for request.url, request.method, automatic basic request.headers,
and the constructor callback receiver's address(). That receiver remains distinct from
WebSocketServer. Full HTTP objects, user-supplied header options, peer metadata, and
request/stream manipulation are excluded. Complex peripheral types may use unknown;
this does not provide missing runtime fields or operations.

Support memory-assigned port=0 and address() with address, family, and port. An omitted
host accepts virtual hostnames and reports ::/IPv6, including for IPv4 client URLs.
Server host supports IP literals and localhost; localhost reports ::1/IPv6. Treat
localhost, 127.0.0.1, and ::1 as lookup aliases while preserving ws-normalized client url.
The fixed IPv6 report intentionally differs from a real host without IPv6 support.
Valid wss targets against plain servers fail as in ws; TLS servers are outside scope.

The [type contract](../ws-contract.md) is checked independently of runtime implementation
and [package validation](https://github.com/electrohyun/smocket/issues/562). Compare supported
runtime behavior against real ws; source type checks alone establish no delivery guarantee.

## Alternatives rejected

- **Continue excluding every ws application API.** The selected application surface can
  be modeled in memory without the transport interception rejected by 0009.
- **Require a factory and Buffer provider.** This adds setup beyond the chosen ws usage;
  direct imports can obtain Buffer without caller injection.
- **Expose complete Node HTTP classes.** Their extra operations, metadata, and identity
  exceed the selected application contract and add unsupported promises.
- **Reproduce native browser WebSocket or wire transport.** Those are separate surfaces;
  they are not required for the selected Node ws usage.
