# Supported published-consumer pin

> **TL;DR** The exact `smocket` dependency in the chat-room consumer is the
> reviewed supported-release pin. Its manifest and lockfile move atomically only
> after release certification, and every scheduled consumer reads that same pin.

## Canonical pin

`consumers/chat-room/package.json` owns the supported exact version. Its lockfile
must repeat that version in the root dependency and installed package entry and must
resolve the tarball from the canonical npm registry. The scheduled workflow validates
this relationship before it installs or runs an application.

The chat-room application consumes the committed lockfile. Clean-adoption fixtures
receive the validated version from the same workflow step; they do not infer it from
the source checkout's package version or an npm dist-tag.

## Updating the supported release

After the authoritative release workflow certifies an exact version, open one reviewed
pull request that changes the chat-room manifest pin and regenerates its lockfile
together. Do not advance the pin when publication or exact-version verification failed.
The pull request CI proves both the old source checkout and the proposed registry pin
without granting npm credentials to pull-request code.

Scheduled and manual runs remain on the committed pin until that pull request lands.
This deliberate lag keeps a newly visible but uncertified version out of the canonical
consumer and leaves an auditable repository change for the supported-version decision.

## Synchronized facade transition

The first certified release containing `smocket-client` adds its exact dependency to
the same manifest and lockfile update. The validator requires the facade version and
exact root peer to equal the root pin. From then on, the scheduled clean-adoption step
installs and exercises both packages.

Until that first facade publication occurs, the current root-only pin remains valid for
the existing published consumer, but it is not evidence that the two-package release
chain required by #284 is complete.
