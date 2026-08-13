# 0023. `smocket-client` is a thin facade

**Status:** Accepted · 2026-08-12 · #235
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md),
[0022](./0022-root-socket-names-server-socket.md)

> **TL;DR** `smocket-client` preserves Socket.IO Client's package-level import shape
> without owning connection state. Its default, `io`, and `connect` exports are one
> facade function over an exact-version `smocket` peer, and its `Socket` is client-only.

## Decision

Socket.IO Client 4.7.5 and 4.8.3 expose one lookup function as the ESM default, `io`, and
`connect`. Their CommonJS root is that callable with `.io` and `.connect` attached. Both
versions export the two-slot client `Socket`; 4.8 also exports transport values that are
outside Smocket's scope. Runtime and external TypeScript consumers under `node16` and
`bundler` supplied this evidence.

`smocket-client` will be a separate package whose ESM default, `io`, and `connect` are one
facade function delegating to `smocket`'s lookup. Its CommonJS root will be that callable
with `.io` and `.connect` referring to itself. Cross-package function identity is not an
API. It will export `ClientSocketContract` as the type `Socket` and only the client option
types supported by Smocket.

The facade keeps Smocket's existing required URL and supported options; it does not add
Socket.IO Client's no-argument, options-only, or Manager-backed overloads. `Manager`,
runtime `Socket`, `protocol`, and transport exports are excluded rather than implying
unsupported reconnection, parser, or transport behavior.

The facade contains no connection implementation and does not bundle `smocket`. It has an
exact-version peer dependency on `smocket`, so both packages resolve the same module-level
server registry when both are loaded through ESM or both through CommonJS. Mixed ESM and
CommonJS loading can instantiate the root package twice and is not part of this guarantee.
Their versions are released together, publishing `smocket` first and the facade second.
The existing `smocket` `io` and `connect` exports remain supported.

Socket.IO Client's CommonJS runtime is callable, but its 4.7.5 and 4.8.3 declarations do
not make `import = require()` callable; `attw` reports the missing `export =`. Smocket's
CommonJS declaration will use `export =` and namespace merging to describe the measured
runtime accurately. ESM declarations keep default and named exports. Both package checks
and external Node, bundler, and browser consumers must pass before publication.

This adds covered package surface without breaking an existing import, so
[0019](./0019-what-counts-as-a-breaking-change.md) classifies it as minor after 1.0.0 and
patch before 1.0.0. An npm registry lookup for `smocket-client` returned 404 when decided;
name availability must still be checked again before the first publication.

## Alternatives rejected

- **Put the client default on `smocket`.** The root already represents the server and
  owns its `Socket`; a client default would restore the direction collision 0022 closed.
- **Use `smocket/client`.** It is unambiguous but does not preserve the package-name-only
  substitution from `socket.io-client`.
- **Duplicate or bundle the implementation.** Two module instances can hold different
  registries, so a facade client could fail to find a server created from `smocket`.
- **Copy every Socket.IO Client export.** Manager, constructors, parser protocol, and
  transports would promise behavior outside the documented logic-layer scope.
- **Copy the upstream CommonJS declaration mismatch.** It weakens the callable-root type
  and fails the package-quality gate despite the runtime being observable and expressible.
