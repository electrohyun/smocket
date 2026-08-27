# Release candidate artifacts

> **TL;DR** Build both packages once, record each tarball's SHA-256 digest, and
> pass that manifest to every artifact-level preflight. This chain is read-only:
> it neither publishes to npm nor certifies a version as released.

Run `pnpm release:candidate` from a clean checkout. It builds `smocket` and
`smocket-client`, packs each package without lifecycle scripts, and writes
`.release-candidate/release-candidate.json`. The command refuses a non-empty
output directory so an earlier candidate cannot be overwritten accidentally.

The manifest fixes the synchronized version, filename, byte length, and SHA-256
digest of both tarballs. Loading it also checks the packed package names and
versions and the facade's exact `smocket` peer. A changed or substituted file is
rejected before another check receives its path.

Run `pnpm check:release-candidate` to apply package policy, Publint, Are The Types
Wrong, and every clean-adoption fixture to the manifest's exact files. CI uploads
that verified set under the commit SHA;
the browser job downloads the same set rather than packing again.

The [npm publication workflow](./npm-publication.md) first requires the complete CI
workflow to have succeeded for its exact dispatch SHA. It downloads that CI run's
SHA-named candidate instead of rebuilding one, then reverifies the manifest immediately
before publishing `smocket` and `smocket-client`, following
[ADR 0023](./decisions/0023-client-package-is-a-thin-facade.md).

The authorized trigger, OIDC relationship, and environment boundary are defined in the
[npm publication workflow](./npm-publication.md). Live npm ownership and package settings
remain outside the repository. The maintainer-owned response after a failed publication
is defined in the [release remediation runbook](./release-remediation.md).

After an authorized workflow publishes both packages, it passes their exact synchronized
version to `pnpm verify:published-release -- --version <version>`. The verifier waits for
both registry identities with a finite attempt count, then installs and exercises the exact
pair outside the checkout. Exhaustion keeps the invoking workflow unsuccessful and hands
control to the [release remediation runbook](./release-remediation.md).
