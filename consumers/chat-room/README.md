# Chat room package consumer

> **TL;DR** This fixture installs a released `smocket` package outside the pnpm
> workspace, then runs the application test and transcript from
> [`examples/chat-room`](../../examples/chat-room/). CI can replace the released
> package with a tarball without creating another application source.

The pinned `0.4.2` release predates `smocket-client`, so this canonical consumer keeps
the root `connect` path required by ADR
[0024](../../docs/decisions/0024-assemble-consumer-from-canonical-example.md). Issue
[#284](https://github.com/electrohyun/smocket/issues/284) owns its atomic transition to
the synchronized two-package release after both packages are published.

[Open the published-package consumer in StackBlitz](https://stackblitz.com/github/electrohyun/smocket)

## What is committed here

This directory is the independent package boundary: npm resolves its dependency instead
of the repository workspace doing so. It contains only:

- `package.json`, with an exact released `smocket` version;
- `package-lock.json`, which records the registry tarball CI actually exercises; and
- this explanation of the two package inputs.

The application stays in [`examples/chat-room`](../../examples/chat-room/). The runner
copies its six JavaScript files and this package configuration into a temporary directory
outside the checkout. Nothing imports Smocket's local source or root `node_modules`.

## Run the published package

Node.js 20 or later and npm are the only prerequisites. From the repository root:

```bash
npm run consumer:chat-room:published
```

The runner performs `npm ci`, verifies the exact installed version and registry
resolution, runs `node --test`, prints the application transcript, and removes the
temporary project even when a step fails.

To update the released version, change the exact version in `package.json` and regenerate
the lockfile with npm. The update belongs in a normal pull request, where the published
workflow exercises the new lock before merge.

## Run the candidate package

After installing the repository dependencies:

```bash
pnpm check:package
pnpm consumer:chat-room:candidate
```

This mode packs the built source under review, changes only the temporary manifest to use
that tarball, performs a clean install, verifies the installed artifact, and runs the same
test and transcript. The committed manifest and lockfile remain unchanged.

## How CI uses it

- The existing `package` job runs candidate mode for every pull request and `main` push.
- The `Published consumer` workflow runs published mode when this fixture, the application,
  or its runner changes, and also runs weekly or on manual dispatch.
- The StackBlitz entry point runs published mode from repository content and disables the
  workspace dependency install.

These checks cover packaging, clean installation, and application integration. Socket.IO
compatibility remains defined by the
[dual-run conformance report](../../docs/conformance.md), not by this consumer.
