# 0003. The Server url argument is required

**Status:** Accepted · 2026-07-28 · #64
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** `new Server(url)` requires its url; there is no argument-less form.
> smocket keeps a `Map` from origin to server and normalizes every `connect(url)`
> to an absolute url before lookup, so the required argument and that registry are
> one decision recorded together.

## Decision

The url passed to `new Server(url)` is required. socket.io always takes a connection
argument, even with a single server in play, and offers no argument-less form, so
smocket requires one too. Making it optional would force an invented rule for what
"two unlabelled servers" mean, a question socket.io never has to answer.

The required url implies a registry, so the two live in one file. smocket keeps a
`Map` from origin to `Server`, and `connect(url)` finds its server by looking the
normalized origin up in that map. Because a server is always keyed by a concrete
url, the map needs no fallback entry for a missing one.

Normalization matches socket.io's own `url.js`: a relative path resolves against
`location.origin`, and a missing port is filled from the scheme, http to 80 and
https to 443, so two urls naming the same origin resolve to one key.

## Alternatives rejected

- **Make the url optional or default it.** socket.io has no argument-less
  connection, so a default has no source to copy, and it would need an invented rule
  to disambiguate two servers created without a url.
- **Skip normalization and key on the raw string.** Two spellings of one origin, a
  bare host and the same host with its default port, would then miss each other in
  the map and split one server into two.
