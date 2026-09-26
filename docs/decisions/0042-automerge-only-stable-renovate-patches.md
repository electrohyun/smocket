# 0042. Automerge only stable Renovate patches

**Status:** Accepted · 2026-09-26 · #511
**Governed by:** [0015](./0015-review-bot-reads-intent-ci-keeps-the-gate.md)

> **TL;DR** Renovate may squash-merge stable development-tool patch updates after
> 14 days when every check passes on the current base. Socket.IO, TypeScript,
> dependencies currently using a 0.x release, GitHub Actions, and every minor or
> major update stay manual.

## Decision

CI remains the mechanical gate from 0015, not a general proof that every dependency
change has the right intent. The exception is limited to generated Renovate pull
requests for patch updates to `devDependencies`, `packageManager`, or
`pnpm.catalog.default` when the dependency's current major version is 1 or later.

The exception excludes `socket.io` and `socket.io-client`, because they are the
behavioral reference, and TypeScript, because compiler adoption is a deliberate
type-surface decision. GitHub Actions have a different dependency type and remain
individual manual reviews. Existing rules continue to hold Node floor pins and keep
pnpm and Vitest majors separate.

Eligible updates wait 14 days, use an up-to-date PR branch, and squash only after
every reported check passes. Renovate performs the merge itself rather than enabling
platform-native automerge, so its stability and artifact checks remain part of the
decision even when they are not repository-wide required checks.

The always-emitted public-surface and published-type jobs join the required ruleset.
Path-conditional and Renovate-only checks do not, because ordinary pull requests may
not emit them.

## Alternatives rejected

- **Keep every Renovate merge manual.** This spends review attention on stable patch
  updates whose generated diff and mechanical gates already answer the merge question.
- **Automerge every non-major.** Minor toolchain releases and patches for dependencies
  currently using a 0.x release can carry compatibility decisions wider than the
  automated exception.
- **Use platform-native automerge.** The platform ruleset does not include every
  Renovate-only status, so it can answer a narrower question than Renovate does.
- **Automerge GitHub Action digests.** An updated action executes inside the check that
  would approve it and may receive secrets, so its tag and provenance stay manual.
