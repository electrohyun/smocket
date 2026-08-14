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
Wrong, the independent chat-room consumer, and every clean-adoption fixture to
the manifest's exact files. CI uploads that verified set under the commit SHA;
the browser job downloads the same set rather than packing again.

The candidate is disposable and may be rebuilt before publication authority is
enabled. A future publication workflow must accept the manifest's exact paths
and reverify both digests immediately before publishing `smocket` and then
`smocket-client`, following [ADR 0023](./decisions/0023-client-package-is-a-thin-facade.md).

This does not define the npm actor, token or OIDC choice, environment or tag
protection, or registry verification retries. The maintainer-owned response after a
failed publication is defined in the [release remediation runbook](./release-remediation.md),
but publication authority still requires a separate decision before any registry write
is enabled.
