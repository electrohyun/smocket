# 0015. A review bot reads a diff against its intent; CI keeps the mechanical checks

**Status:** Accepted · 2026-08-04 · #101

> **TL;DR** CI's five checks verify a change compiles, conforms, and matches
> real socket.io, but none read what the change is for. CodeRabbit adds that
> layer, reading a diff against its stated intent; CI keeps the merge gate.

## Decision

The review work is split in two, along the line CI cannot cross.

CI keeps the gate. `typecheck`, `lint`, `format:check`, `coverage`, and `test:mock`
stay the merge condition. The bot does not block a merge (`request_changes_workflow`
is off), and the CodeRabbit linters that would re-run what CI already does are
disabled, so the two layers never check the same thing twice.

The bot takes the one review the five checks structurally cannot do. Its rules are
encoded in `.coderabbit.yaml` as path instructions, so the review starts from this
repo's premises rather than a generic reviewer's. It watches for:

- a behavior change without a test passing on both targets
- a suggestion to build what `docs/scope.md` places out of scope
- a field populated with no real source (0000)
- a one-directional write to the rooms and sids index
- a change to the shared contract both engines are verified against
- non-delivery proven by a timeout instead of the marker helpers
- an English doc changed without its Korean twin

The configuration is versioned in the repo. `.coderabbit.yaml` is the single source
of truth and overrides the dashboard, so the review rules are read and changed the
same way as the rest of the code.

## Alternatives rejected

- **No automated review, keeping author self-review.** This held across 48 merged
  pull requests, but the one seam it missed (#80, ack buffering across reconnect) was
  the kind CI cannot catch either, and as outside contributions open up, no review
  would wait for a contributor who is not the maintainer.
- **The assertive review profile.** A high-volume reviewer buries the diff under
  restatements and low-value nits. The value here is the few intent-level notes, not
  their number, so the chill profile is used.
