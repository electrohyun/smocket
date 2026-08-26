# Completing a certified release

> **TL;DR** Create the version tag and GitHub Release only after the authoritative
> workflow verifies both exact registry packages. Both must point to the certified
> SHA, and the Release records the CI run and candidate digests that reached npm.

## Preconditions

The successful `verify exact published release` job is the certification signal. Before
creating either GitHub object, confirm that its workflow record identifies:

- one successful `main` CI run whose head is the dispatch SHA;
- the candidate manifest promoted from that CI run;
- both tarball SHA-256 digests from the manifest;
- exact `smocket` and `smocket-client` registry versions;
- the client's exact `smocket` peer for the same version;
- a successful clean installation and execution of the exact registry pair.

The CI artifact is retained for a bounded period, so copy its two digests into the
release notes while the run and artifact are available. The workflow run remains the
authority for the registry verification result.

## Tag and GitHub Release

After every precondition succeeds:

1. create `v<version>` at the certified dispatch SHA;
2. create the GitHub Release from that tag without changing its target;
3. link the exact-SHA CI run and the successful publication workflow run;
4. record both package names, exact version, and candidate SHA-256 digests;
5. link the two exact npm package-version pages and summarize the release changes.

The tag and GitHub Release describe an already certified publication. They do not
trigger npm publication, replace the verifier, or certify another commit with the same
source tree.

## Partial failure

Do not create a tag or GitHub Release while either package is missing, the client peer
is wrong, registry visibility is exhausted, clean adoption fails, or a digest differs.
Keep the workflow unsuccessful and follow the
[release remediation runbook](./release-remediation.md). A root-only publication may be
completed at the same version when the client failure is purely operational; otherwise
deprecate or fix forward as the runbook requires. Neither state is a certified release.
