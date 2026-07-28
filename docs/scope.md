# Scope

> **TL;DR** smocket reproduces socket.io's logic layer (which socket receives
> which event, and why) and nothing from the reliability layer. The out-of-scope
> items are not unbuilt features: a mock has no real network, so there is nothing
> to retry, fall back from, or reconnect to. This file is that boundary.

The split follows the two layers socket.io stacks. The logic layer decides
delivery and routing; the reliability layer keeps a connection alive over an
unreliable network. smocket pairs a client and its server socket directly in
memory, so it can reproduce the first layer exactly, and the second layer has
nothing to act on.

## Reproduced (logic layer)

- The connection concept and the [sid](./glossary.md#sid): connect, disconnect,
  and `socket.id`.
- `emit` / `on` event dispatch between a client and its server socket.
- [ack](./glossary.md#ack): a value returned to the sender, in either direction.
- [room](./glossary.md#room) `join` / `leave`, kept in both directions of the
  roster.
- [broadcast](./glossary.md#broadcast): `io.to`, `socket.to`, `socket.broadcast`,
  and `except`.
- [namespace](./glossary.md#namespace) isolation across `io.of(name)`.
- Multiple clients connected at once.
- Room cleanup when a socket disconnects.

## Not reproduced (reliability / network layer)

None of these can exist in a mock, because a mock never opens a real connection:

- **reconnection behavior reproduction**: there is no dropped connection to
  re-establish. (A reconnect simulation trigger, letting you force a
  "now disconnected" state to exercise your own reconnect handlers, is a separate
  planned feature, and is not this.)
- **transport fallback**: there is no WebSocket or HTTP long-polling transport to
  fall back between.
- **heartbeat**: there is no live connection to ping, so none can time out.
- **multi-server scaling** (the Redis [adapter](./glossary.md#adapter),
  `serverSideEmit`): one in-memory process has no second server to reach.
- **binary encoding / engine framing**: nothing is serialised onto a wire, so
  there are no frames to encode.
