# Root package dependency policy

> **TL;DR** The root `smocket` package ships with no runtime, optional, peer, or
> bundled dependencies. The required package check enforces that policy against
> both source metadata and the actual tarball; a future `smocket-client` facade
> has a separate exact-peer policy settled by [0023](./decisions/0023-client-package-is-a-thin-facade.md).

The root package is a self-contained mock implementation. Its `dependencies`,
`optionalDependencies`, `peerDependencies`, and `peerDependenciesMeta` fields must be
absent or empty. `bundleDependencies` and `bundledDependencies` may only be absent,
`false`, or an empty list, and the packed artifact must contain no `node_modules`
payload.

`pnpm check:package` builds the root package, checks that the built files import no
external modules, packs the package, and inspects the source manifest, packed manifest,
and tar entries. Publint, Are The Types Wrong, and the independent candidate consumer
remain separate evidence over the same package boundary.

This rule does not apply to a future separate `smocket-client` package. ADR
[0023](./decisions/0023-client-package-is-a-thin-facade.md) requires that facade to have
an exact-version `smocket` peer so both imports share one registry; its package check must
enforce that exact peer rather than weaken the root policy.
