# Root package dependency policy

> **TL;DR** The root `smocket` package ships with no runtime, optional, peer, or
> bundled dependencies. The required package check enforces that policy against
> both source metadata and the actual tarball. The `smocket-client` facade ships
> separately with one exact-version `smocket` peer and no bundled implementation.

The root package is a self-contained mock implementation. Its `dependencies`,
`optionalDependencies`, `peerDependencies`, and `peerDependenciesMeta` fields must be
absent or empty. `bundleDependencies` and `bundledDependencies` may only be absent,
`false`, or an empty list, and the packed artifact must contain no `node_modules`
payload.

`pnpm check:package` builds the root package, checks that the built files import no
external modules, packs the package, and inspects the source manifest, packed manifest,
and tar entries. Publint, Are The Types Wrong, and the independent candidate consumer
remain separate evidence over the same package boundary.

The separate `smocket-client` package follows [ADR 0023](./decisions/0023-client-package-is-a-thin-facade.md).
`pnpm check:client-package` requires its version to equal the root version, its only peer
to be that exact `smocket` version, and its tarball to contain no bundled dependency. It
also runs Publint and Are The Types Wrong against the packed ESM and CommonJS entries.

A release bumps both manifests to one version. Publish `smocket` first, then publish
`smocket-client`. The facade's `prepublishOnly` check reads the registry and rejects the
second publication until that exact root version exists.
