# 0013. Reconnecting yields a fresh socket, not the old one

**Status:** Accepted · 2026-07-28 · #67

> **TL;DR** `client.connect()` after a disconnect produces a new server socket
> with a new id and no previous [room](../glossary.md#room) membership; calling
> `connect()` while already connected is a no-op. This matches real socket.io.

## Decision

Reconnecting a client with `client.connect()` pairs it with a brand-new server
socket that has a new id and none of the socket's previous room memberships. It
does not revive the old socket or restore old rooms. Calling `connect()` on an
already-connected client does nothing, matching real socket.io-client.

This was verified against real socket.io: a reconnect there is a new session, not
a resumed one, so the fresh id and empty rooms are the reference behaviour rather
than a simplification smocket chose.

Related and observable: on disconnect the socket's `rooms` set is emptied in
place, not replaced with a new set. A caller holding a reference to that set sees
it become empty, which the contract pins as observable, so the in-place clear is a
decision and not an implementation detail free to change.

## Alternatives rejected

- **Reuse the previous socket and id on reconnect.** Convenient, but real
  socket.io issues a new session, and reusing the id would make smocket disagree
  with the reference on the very thing a reconnect test checks.
- **Auto-rejoin the previous rooms.** A client may want that, but socket.io does
  not do it automatically, so membership after reconnect starts empty.
