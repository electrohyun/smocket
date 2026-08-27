# 0024. Assemble the consumer from the canonical example

**Status:** Superseded by [0039](./0039-retire-legacy-chat-room-evaluation.md) · 2026-08-27 · #451

> **TL;DR** Keep the chat application in `examples/chat-room` and its independent
> package boundary in `consumers/chat-room`. CI assembles both outside the checkout,
> so clean installs do not require a second application source or repository.

## Decision

`examples/chat-room` remains the canonical application and continues to depend on
`smocket` through `workspace:*`. `consumers/chat-room` contains only the manifest,
lockfile, and instructions that define an independent npm consumer.

A repository script copies those two inputs into a temporary directory outside the
checkout. Published validation installs the exact released version recorded in the
manifest and lockfile. Candidate validation replaces that dependency only in the
temporary copy, installs the tarball produced from the source under review, and runs the
same application test.

Candidate validation extends the existing package CI job because it examines the same
artifact on every pull request and `main` push. Published validation has its own workflow
because registry input, scheduled checks, manual runs, and version-update pull requests
have a different lifecycle.

The browser sandbox starts from the repository root so the runner can read both committed
inputs. A generated mirror is permitted only if a sandbox provider is proven to require an
independent source tree; it must never become a second hand-maintained application.

This consumer proves installation and application integration across a package boundary.
It does not replace the [dual-run conformance report](../conformance.md) as evidence of
Socket.IO behavior.

## Alternatives rejected

- **A dedicated repository.** A temporary clean install supplies the package boundary
  without cross-repository ref selection, synchronization, or another maintenance surface.
- **Copy the application into `consumers/chat-room`.** Two editable copies can drift and
  leave #113, #208, and #218 exercising different workflows.
- **Commit a generated mirror immediately.** The repository-root sandbox can assemble the
  inputs directly. Generation remains a fallback for a demonstrated provider constraint.
