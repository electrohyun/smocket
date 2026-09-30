# Public surface ledger

> **TL;DR** The generated inventory extracts the declared Socket.IO target from
> the root's exact pins, and the reviewed ledger classifies every entry. CI rejects
> declaration drift, stale classifications, and unclassified keys or signatures.

[`public-surface.generated.json`](./public-surface.generated.json) is derived from
the exact root `socket.io` and `socket.io-client` pins, initially 4.8.4 for both.
The server resolves its own `socket.io-adapter` 2.5.8. The inventory records the
extractor's pinned TypeScript version because it can change declaration parsing.
It omits pnpm because package-manager updates do not change the extracted surface.

The inventory covers package export maps and root declarations, `Server`,
`Namespace`, reachable `ParentNamespace`, `BroadcastOperator`, both Socket
directions, `Manager`, and the built-in Adapter. It expands inherited instance
members and class static members, keeps `declaredBy`, and records receiver,
overload index, declaration kind, readonly state, optionality, and the normalized
declaration signature. Private and protected static declarations are excluded.
The installed packages and the upstream pins in examples and consumers must match
the declared pins. A target change requires regenerating the inventory and reviewing
the changed declarations.

Evidence tiers stay distinct:

- `declaration-public` comes from public declarations or package exports;
- `officially-documented` is public documentation not expressed by declarations;
- `runtime-only` is source-visible but private or internal declaration surface.

[`public-surface-ledger.json`](./public-surface-ledger.json) is the reviewed file.
Every inventory id has exactly one disposition: `implemented`, `tracked-issue`,
`ADR-deferred`, `out-of-scope`, or `non-user-facing`. Tracking an open issue is a
valid classification; the inventory does not require every upstream member to be
implemented. [`conformance.md`](./conformance.md) remains case evidence and is
never used to generate the upstream inventory.

## Upstream attribution and package boundary

The inventory uses the declarations and package metadata from `socket.io` and
`socket.io-client` 4.8.4 and their resolved `socket.io-adapter` 2.5.8.
Runtime-only client emitter entries reference `@socket.io/component-emitter`
3.1.2. The upstream repositories, copyright notices, and MIT license references
are recorded in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

This inventory is generated compatibility evidence for the repository. It is not
part of smocket's runtime and is excluded from both npm packages.

## Regenerate and review

1. Run `pnpm install --frozen-lockfile` so the exact root pins resolve.
2. Run `pnpm public-surface` to regenerate only the source inventory.
3. Review every added, removed, or changed key and exact signature for the target.
4. Add one ledger disposition and its issue, ADR, scope, or implementation
   reference for every new inventory id; remove classifications that became stale.
5. Run `pnpm check:public-surface`.
6. Run `pnpm check:public-surface-issues` with network access before release; CI uses
   its GitHub token to reject `tracked-issue` references after they close.

Do not edit generated entries to hide upstream drift. Update the extractor only
when the declaration normalization itself is wrong, then regenerate and review
the full diff. Public smocket changes consume the existing vocabulary; they do
not weaken this guard or the separate `check:package` policy.
