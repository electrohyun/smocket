# Decision records

> **TL;DR** One row per architecture decision, with a one-line summary and the
> issues it relates to. The Issues column resolves the `#40` to `#45` coordinates
> that appear in source comments but link nowhere else in the repo.

Each file states one decision and keeps its number for life; it is never
renumbered, and a reversed decision changes its Status to `Superseded by 00NN`
rather than moving. See [../CONTRIBUTING-docs.md](../CONTRIBUTING-docs.md) for how
these are written.

| #                                                                       | Decision                                                                                | Status             | Issues               |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------ | -------------------- |
| [0000](./0000-do-not-invent-what-has-no-source.md)                      | Fill only what real socket.io observably does; never invent                             | Accepted           | #64                  |
| [0001](./0001-server-not-mockserver.md)                                 | The public class is `Server`, not `MockServer`                                          | Accepted           | #64                  |
| [0002](./0002-construction-is-activation.md)                            | `new Server(url)` is activation; there is no `start()`                                  | Accepted           | #64                  |
| [0003](./0003-url-is-required.md)                                       | The `Server` url argument is required                                                   | Accepted           | #64                  |
| [0004](./0004-connection-deferred-one-tick.md)                          | Connection completes one tick later so `connect` handlers register in time              | Accepted           | #40, #65             |
| [0005](./0005-missing-server-behavior.md)                               | A missing server fires `connect_error` at once, no retry, plus `console.error`          | Accepted           | #65                  |
| [0006](./0006-handshake-fields.md)                                      | The handshake carries only fields a mock has a source for                               | Accepted           | #65                  |
| [0007](./0007-no-unchecked-indexed-access.md)                           | `noUncheckedIndexedAccess` guards the delivery-layer map lookups                        | Accepted           | #66                  |
| [0008](./0008-adapter-api-before-v1.md)                                 | The adapter registration API lands before v1.0.0                                        | Accepted           | #66                  |
| [0009](./0009-no-raw-websocket-mocking.md)                              | smocket does not mock raw WebSocket; that is MSW's lane                                 | Accepted           | #66                  |
| [0010](./0010-single-defer-primitive-and-fifo.md)                       | One `defer` primitive keeps per-socket delivery FIFO                                    | Accepted           | #40, #41, #67        |
| [0011](./0011-socket-id-format.md)                                      | Socket ids match socket.io's shape, not its source                                      | Accepted           | #67                  |
| [0012](./0012-reject-inflight-acks-on-disconnect.md)                    | Timed client callbacks settle on disconnect; retained callbacks stay connection-owned   | Accepted           | #45, #67, #359, #360 |
| [0013](./0013-reconnect-fresh-socket.md)                                | Reconnecting yields a fresh socket and id, with no old rooms                            | Accepted           | #45, #67             |
| [0014](./0014-connection-handler-fires-before-client-connect.md)        | `io.on('connection')` fires the server side before the client connect                   | Accepted           | #88, #350            |
| [0015](./0015-review-bot-reads-intent-ci-keeps-the-gate.md)             | A review bot reads a diff against intent; CI keeps the mechanical checks                | Accepted           | #101                 |
| [0016](./0016-volatile-drops-only-pre-connect.md)                       | volatile is accepted and drops only in the pre-connect window                           | Accepted           | #110                 |
| [0017](./0017-off-follows-the-emitter.md)                               | off follows the underlying emitter: Node on the server, component-emitter on the client | Accepted           | #103                 |
| [0018](./0018-delivery-scheduling-adapter-hook.md)                      | Per-socket delivery delay is an adapter scheduling hook, keyed by sid, preserving FIFO  | Accepted           | #78                  |
| [0019](./0019-what-counts-as-a-breaking-change.md)                      | A version number promises fidelity, not the current result                              | Accepted           | #115                 |
| [0020](./0020-close-follows-socket-lifecycle.md)                        | `close()` tears down sockets and unregisters only the current server                    | Accepted           | #193, #359           |
| [0021](./0021-event-maps-cross-the-substitution-seam.md)                | Event maps and socket data survive the server substitution seam                         | Accepted           | #171                 |
| [0022](./0022-root-socket-names-server-socket.md)                       | Root `Socket` names the server type; `smocket-client` owns the client type              | Accepted           | #178, #235           |
| [0023](./0023-client-package-is-a-thin-facade.md)                       | `smocket-client` re-exports one shared client lookup without owning connection state    | Accepted           | #235                 |
| [0024](./0024-assemble-consumer-from-canonical-example.md)              | Assemble an independent consumer from the canonical chat application                    | Superseded by 0039 | #208, #451           |
| [0025](./0025-built-in-adapter-observation-stays-rooms-only.md)         | Built-in Adapter observation stays on the live `rooms` map                              | Accepted           | #238                 |
| [0026](./0026-payloads-cross-a-json-snapshot-boundary.md)               | Non-binary payloads cross the default parser's JSON snapshot boundary                   | Accepted           | #237, #250           |
| [0027](./0027-one-workflow-drives-three-case-study-targets.md)          | One workflow drives three isolated application case-study targets                       | Superseded by 0039 | #218, #451           |
| [0028](./0028-disconnect-true-closes-the-shared-manager-group.md)       | `disconnect(true)` closes the shared client Manager group                               | Accepted           | #236, #254           |
| [0029](./0029-narrowed-parent-broadcasts-stay-unverified.md)            | Parent broadcast conformance stops before narrowing                                     | Accepted           | #269                 |
| [0030](./0030-public-connection-api-settles-on-close.md)                | The public direct connection API rejects observers when its server closes               | Accepted           | #277, #350           |
| [0031](./0031-adapter-registration-and-removal-lifecycle.md)            | Adapters register before admission and may observe whole-socket removal                 | Accepted           | #278                 |
| [0032](./0032-trace-final-broadcast-routing.md)                         | Trace final broadcast routing without retaining payloads                                | Accepted           | #262                 |
| [0033](./0033-socket-state-follows-lifecycle-not-delivery-readiness.md) | Socket state follows lifecycle while volatile delivery uses private client readiness    | Accepted           | #275                 |
| [0034](./0034-packet-middleware-completes-independently.md)             | Packet middleware preserves entry order and completes independently                     | Accepted           | #268                 |
| [0035](./0035-inherited-emitter-follows-each-receiver.md)               | Inherited emitter behavior follows each receiver                                        | Accepted           | #274                 |
| [0036](./0036-drop-final-broadcast-recipients-by-sid.md)                | Drop final broadcast recipients by sid                                                  | Accepted           | #263                 |
| [0037](./0037-keep-broadcast-management-local-and-canonical.md)         | Keep local broadcast management canonical                                               | Accepted           | #265                 |
| [0038](./0038-shared-worker-is-an-explicit-narrow-facade.md)            | SharedWorker uses explicit host and client subpaths with a narrow facade                | Accepted           | #376, #377, #379     |
| [0039](./0039-retire-legacy-chat-room-evaluation.md)                    | Retire chat-room evaluation paths after maintained replacements exist                   | Accepted           | #451                 |
