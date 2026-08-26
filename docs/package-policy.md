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

`pnpm check:package` remains the standalone root check. The release path instead creates
one [immutable candidate set](./release-candidates.md), checks that the built files import
no external modules, and passes its digest-verified root tarball to package policy,
Publint, Are The Types Wrong, and the independent candidate consumers.

The separate `smocket-client` package follows [ADR 0023](./decisions/0023-client-package-is-a-thin-facade.md).
`pnpm check:client-package` requires its version to equal the root version, its only peer
to be that exact `smocket` version, and its tarball to contain no bundled dependency. The
tarball must also carry the package README and MIT license. The release candidate check
applies the same policy plus Publint and Are The Types Wrong to the manifest's exact
facade tarball.

A release bumps both manifests to one version. Publish `smocket` first, then publish
`smocket-client`. The authoritative candidate publisher reads the registry and rejects
the client publication until that exact root version exists, including its
`--ignore-scripts` tarball path. The facade's `prepublishOnly` check mirrors the same
ordering rule for direct source-package publication.
