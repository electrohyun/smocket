# 0004. Connection completes one tick later so the connect handler is registered in time

**Status:** Accepted · 2026-07-28 · #65

> **TL;DR** smocket defers connection completion to the next tick; emits sent in
> the gap are buffered and delivered once the socket connects. A synchronous
> connection would pass events before `socket.on('connect', ...)` is registered,
> so real code that works against socket.io would silently break in the mock.

## Decision

Connection completion is deferred one tick. `connect()` returns a not-yet-connected
client, and a tick later, through the one `defer` primitive, the pairing completes
and the `connect` event fires. Any emit sent in that gap is buffered and delivered
after the socket connects, in send order.

The reasoning starts from the ordering real code depends on. A caller writes
`const socket = connect(url)` and then `socket.on('connect', ...)` on the next
line. If connection completed synchronously inside `connect()`, the `connect`
event would have fired before that handler existed, so the handler would never
run and the first events would be lost. Deferring completion one tick leaves room
for the handler to register first, which is why the `defer` comment in
`mock-server.ts` records connect resolving a tick later "so a
`socket.on('connect', ...)` handler is registered in time."

This has a source in real socket.io, where a connection is asynchronous and the
`connect` event never fires in the same tick as the `connect()` call, so the mock
copies that timing rather than inventing it. That is why this decision carries no
`Governed by` line.

## Alternatives rejected

- **Complete the connection synchronously.** The `connect` event would fire inside
  `connect()`, before any handler the caller adds on the following line, so the
  handler would miss it and the first emits would be dropped. Real code that runs
  against socket.io would break only in the mock, defeating dual-run parity.
- **Fire `connect` on a separate clock (for example `setTimeout`) from emits.** Two
  schedulers give no ordering guarantee between the connect and the first emits, so
  a `connect` handler could still miss an event a real client would see. One `defer`
  keeps both on the same FIFO queue.
