# Failed release verification response

> **TL;DR** A published version is certified only when the authoritative release
> workflow verifies both exact packages. A failure keeps that workflow red and
> requires a maintainer-owned deprecation or synchronized fix-forward decision.

## Ownership and certification

The maintainer who starts a release owns its response until another repository
maintainer explicitly takes over. Only a maintainer who already holds the required
npm role may publish or deprecate; pull-request code and untrusted workflows receive
no such authority.

The successful conclusion of exact-version verification in the authoritative
[npm publication workflow](./npm-publication.md) is the certification signal. Until
then, do not announce the version as verified, create a success marker, or treat a
GitHub tag or Release as proof.

## On failure

Open or update one release incident issue before retrying a package operation. Record:

- the exact synchronized version and both package names;
- the failed workflow run and job;
- the registry response or consumer failure without credentials;
- whether `smocket` and `smocket-client` were each published;
- the maintainer decision, owner, and next action;
- the replacement version when the response is fix-forward.

A not-found or stale registry response may use only the verifier's bounded retries.
After those attempts, keep the workflow unsuccessful and resume it manually only after
the incident records evidence that the exact same version became visible. Do not turn
a consumer, metadata, integrity, or peer-dependency failure into extra propagation
retries.

## Deprecate or fix forward

Deprecate every published member of the failed synchronized pair when it is unusable,
misleading on its own, has incorrect package metadata or peer constraints, or has a
security defect. The npm owner supplies a short replacement or incident reference and
records the command result without exposing credentials.

Otherwise, fix forward. Increase both package versions together, build a new immutable
candidate, pass all pre-publication gates again, then publish `smocket` before
`smocket-client`. Verify the new exact pair independently. Never unpublish merely to
reuse a version, overwrite a tarball, or describe the response as a rollback.

If only `smocket` was published before `smocket-client` failed, the pair is incomplete.
The incident owner either completes the facade publication after resolving a pure
propagation problem or deprecates the root version and fixes forward both packages.

This runbook defines the response, not npm authority. The authorized trigger, OIDC
identity, and repository protections are defined by the
[npm publication workflow](./npm-publication.md).
