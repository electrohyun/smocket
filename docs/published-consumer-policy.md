# Supported published-consumer pin

> **TL;DR** `consumers/published-release.json` records the reviewed exact release
> and whether its synchronized client facade is available. Scheduled clean-adoption
> checks read that pin only after release certification.

## Canonical pin

`consumers/published-release.json` owns the supported exact version and explicitly states
whether the same version of `smocket-client` is part of the certified release. The
scheduled workflow validates the file before installing those exact registry packages.

Clean-adoption fixtures receive the validated version from that workflow step. They do
not infer it from the source checkout's package version or an npm dist-tag, and npm
resolves a fresh dependency graph outside the repository checkout.

## Updating the supported release

After the authoritative release workflow certifies an exact version, open one reviewed
pull request that changes the supported-release file. Do not advance the pin when
publication or exact-version verification failed. The pull request CI proves both the
old source checkout and the proposed registry pin
without granting npm credentials to pull-request code.

Scheduled and manual runs remain on the committed pin until that pull request lands.
This deliberate lag keeps a newly visible but uncertified version out of the canonical
consumer and leaves an auditable repository change for the supported-version decision.

## Synchronized facade transition

The first certified release containing `smocket-client` changes `includesClient` to
`true`. The scheduled clean-adoption step then installs the facade at the same exact
version and verifies its exact root peer before exercising both packages.

Until that first facade publication occurs, a root-only pin remains valid for the
scheduled clean-adoption check, but it is not evidence that the two-package release
chain required by #284 is complete.
