# 0033. Socket state follows lifecycle, not delivery readiness

**Status:** Accepted · 2026-08-13 · #275
**Governed by:** [0013](./0013-reconnect-fresh-socket.md),
[0016](./0016-volatile-drops-only-pre-connect.md),
[0028](./0028-disconnect-true-closes-the-shared-manager-group.md)

> **TL;DR** Public Socket connection state follows Socket.IO lifecycle timing.
> Server lifecycle state stays separate from client delivery readiness, mutable
> client auth is read for every manual connection, and recovery remains unsupported.

## Decision

Socket.IO server sockets report `connected` as false in connection middleware,
true in `connection` and `disconnecting`, then false in `disconnect`. The
`disconnected` getter is its exact inverse. Smocket changes these values at the
same lifecycle boundaries.

The server socket state cannot also represent whether the paired client has fired
its `connect` event. During the server `connection` handler the server socket is
connected while the client is still in the pre-connect delivery window. Volatile
delivery therefore reads a separate private client-readiness value and keeps the
drop rule from [0016](./0016-volatile-drops-only-pre-connect.md).

Socket.IO exposes mutable client `auth` and reads it when a connection starts.
Smocket retains stable lookup options but resolves the current `socket.auth` on
every manual `connect()`, including dynamic namespace admission. Object replacement
and callback auth can therefore supply a fresh handshake value after disconnect.

Smocket does not reproduce connection-state recovery. Its server and client
`recovered` values are false for every completed connection. This observable value
does not add packet restoration, reconnect automation, recovery identifiers, or
recovery buffers.

Client `active`, `receiveBuffer`, and `sendBuffer` remain outside the public contract.
`active` describes Manager reconnection policy, while the buffers expose parser and
transport lifecycle details beyond the in-memory delivery boundary.

## Alternatives rejected

- **Derive server state from the paired client.** This makes the server appear
  disconnected during its own `connection` handler and couples lifecycle state to
  volatile delivery readiness.
- **Capture auth only at construction.** Application token rotation through
  `socket.auth` would not reach a later manual connection.
- **Implement recovery to expose `recovered`.** The property can truthfully stay
  false without adding the recovery behavior excluded by project scope.
- **Expose internal client buffers.** Their contents and timing belong to parser and
  transport behavior that Smocket does not reproduce.
