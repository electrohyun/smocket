# 0022. Root `Socket` names the server socket

**Status:** Accepted · 2026-08-12 · #178
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md),
[0021](./0021-event-maps-cross-the-substitution-seam.md)

> **TL;DR** The `smocket` root exports the server `Socket` type so a server import can
> change only its package name. The separate `smocket-client` package owns the client
> type, preserving the same package-level split as Socket.IO.

## Decision

Socket.IO 4.7.5 and 4.8.3 export `Socket` from both `socket.io` and
`socket.io-client`. Those are separate package roots: the server type carries four
generic positions, while the client type carries two and reverses the event directions.
External fixtures under `node16` and `bundler` resolution verified both valid calls and
wrong-direction rejections.

Smocket combines both directions in one package, but its root already exposes `Server`.
The root will therefore export `ServerSocketContract` as the named type `Socket`, letting
a server replace `socket.io` with `smocket` without changing its named imports.
The separate `smocket-client` package will export `ClientSocketContract` as `Socket`,
letting a client replace `socket.io-client` without changing its named imports. Their
generic order and defaults remain those fixed by
[0021](./0021-event-maps-cross-the-substitution-seam.md).

The documented client substitution keeps the application's `socket.io-client` import and
redirects it at runtime, so TypeScript continues to read the original client `Socket`.
A source-level substitution can instead change that package name to `smocket-client`; it
must not receive the server type from `smocket` by accident.

[#235](https://github.com/electrohyun/smocket/issues/235) owns the executable entry-point
shape, ESM default and CommonJS callable behavior, and the resulting `exports` map. It
must define `smocket-client` as a thin client facade over the shared implementation,
including synchronized versions and publication, without duplicating connection state.
Adding the type aliases is a public type addition that keeps existing call sites
compiling, so [0019](./0019-what-counts-as-a-breaking-change.md) classifies it as minor
after 1.0.0 and patch before 1.0.0.

This decision does not expose a runtime `Socket` constructor. Both upstream packages do,
but their constructors differ from Smocket's internal constructors, and no measured
application use case requires construction. Runtime constructor compatibility remains
unverified rather than being inferred from the type name.

## Alternatives rejected

- **Give the root name to the client socket.** It breaks the package-name-only server
  substitution, while the documented runtime client substitution already retains
  `socket.io-client`'s own type.
- **Leave the root name unassigned.** It avoids choosing a direction but forces an
  existing server import to change both the package and the import path.
- **Use `smocket/client` and `smocket/server` subpaths.** The types are unambiguous, but
  both directions adopt a Smocket-specific import convention instead of preserving
  Socket.IO's package-level substitution shape.
- **Leave `Socket` unavailable everywhere.** Explicit contract names remain usable, but
  application annotations cannot retain Socket.IO's name across package substitution.
- **Export the internal classes as constructors.** Their construction APIs are not the
  upstream APIs, so the shared name would claim compatibility that has not been proved.
