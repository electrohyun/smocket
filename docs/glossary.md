# Glossary

> **TL;DR** The lookup reference for the socket.io domain terms that recur across
> smocket's docs. Each doc links here on first use and never redefines a term.
> Entries describe socket.io itself; smocket-specific behaviour lives in its own
> owning doc.

Terms are listed in dependency order: later entries lean on earlier ones.

## room

A server-side label a socket can `join` and `leave`. A broadcast can target a
room to reach exactly its current members, and one socket may belong to many
rooms at once.

## namespace

A named channel (a path such as `/` or `/admin`) with its own sockets, rooms, and
handlers. Isolation is complete: a broadcast on one namespace never reaches a
socket on another.

## adapter

The per-namespace component that stores room membership and resolves which
sockets a broadcast targets. The default holds this in memory; the Redis adapter
replaces it to span multiple servers.

## ack

Short for acknowledgement. A callback passed as the last argument to `emit`; the
receiver calls it to send a value back, turning a single event into a
request/response round trip.

## handshake

The initial exchange when a client connects, carrying connection metadata such as
headers, query, and auth. The server reads it as `socket.handshake`.

## broadcast

Sending one event to many sockets at once instead of to a single peer. `io.emit`
reaches every socket on the namespace; a room or an `except` narrows that set.

## sid

A socket's session id: the unique identifier assigned on connect and held in
`socket.id`. Each socket also auto-joins a room named after its own sid, which is
how a broadcast can address a single socket.

## nsp

socket.io's own short name for a namespace, used as a property (`socket.nsp`) and
returned by `io.of(name)`. See namespace.

## broadcast operator

The object returned by `io.to(room)`, `socket.broadcast`, `socket.except(room)`,
and their siblings. It holds the target and excluded room sets and exposes `emit`,
so every broadcast form is one mechanism built with different sets.
