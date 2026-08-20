# 0030. The public direct connection API settles on close

**Status:** Accepted · 2026-08-13 · #277, #350
**Governed by:** [0014](./0014-connection-handler-fires-before-client-connect.md),
[0020](./0020-close-follows-socket-lifecycle.md),
[0028](./0028-disconnect-true-closes-the-shared-manager-group.md)

> **TL;DR** `Server.connect()` and `nextConnection()` are the two public halves of
> Smocket's direct connection API. They pair admitted sockets in per-namespace FIFO
> order. Closing the server discards unclaimed sockets and rejects pending or later
> observers with an ordinary `Error`.

## Decision

Real Socket.IO opens a client through socket.io-client and exposes the server side through a
`connection` listener. It has no `Server.connect()` or `nextConnection()` counterpart. Smocket
keeps that compatible path through `connect(url)`, while the concrete `Server` also supports a
direct test API that avoids the origin registry.

`Server.connect(namespace?, options?)` remains public and joins `SmocketServer`. It normalizes
the namespace, preserves the event-map direction, accepts the same Smocket `ConnectOptions` as
`connect(url)`, and uses the Manager grouping fixed by [0028](./0028-disconnect-true-closes-the-shared-manager-group.md).
`nextConnection(namespace?)` is its observing half. Both default to `/`.

Each existing namespace keeps one FIFO queue of admitted but unclaimed server sockets and one
FIFO queue of waiting observers. Either call may arrive first after that namespace exists. The
root exists when the server is constructed. A named static namespace must first be registered
through `of()` or established by an earlier `nextConnection()` because `connect()` does not
register a rejected client destination. Multiple calls pair in connection order, and
normalization never merges distinct namespaces. `nextConnection()` and a `connection` listener
observe the same server Socket under the ordering fixed by
[0014](./0014-connection-handler-fires-before-client-connect.md).
If middleware completes repeatedly, lifecycle listeners observe each completion while the
direct API queues that admitted Socket once; repeated completion does not create another Socket.

A rejected or cancelled admission never consumes an observer. The observer remains queued for
the next admitted socket. This is proved with that later admission as the completion marker,
not by waiting for a timeout.

Close ends the direct connection API together with the socket lifecycle. A socket already
claimed by `nextConnection()` stays that call's result and is disconnected normally. An
admitted but unclaimed socket is discarded. A pending observer and every observer created after
close reject with `Error('server is closed')`. Waiting observers for a dynamic namespace that
has not been created reject the same way. The dynamic parent admission and child creation rules
established by #269 stay unchanged.

## Alternatives rejected

- **Remove `Server.connect()` and hide native connections behind test helpers.** The exported
  class already exposes the method, native adapter tests use it, and the public
  `nextConnection()` observer needs an intentional direct driver.
- **Leave observers pending after close.** A promise that can no longer receive a socket must
  settle when the lifecycle that owned it ends.
- **Resolve with `undefined` or a cancellation sentinel.** That would widen every successful
  call and make an admitted server Socket harder to use.
- **Return unclaimed sockets after close.** Those sockets have already entered teardown and
  cannot represent a new connection observation.
