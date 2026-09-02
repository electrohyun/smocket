# 0039. Retire legacy chat-room evaluation paths

**Status:** Superseded by [0040](./0040-keep-drawing-game-executable.md) · 2026-09-02 · #476
**Supersedes:** [0024](./0024-assemble-consumer-from-canonical-example.md),
[0027](./0027-one-workflow-drives-three-case-study-targets.md)

> **TL;DR** Keep `examples/chat-room` as a small executable example, but retire its
> independent package consumer and recorded case study. The drawing-game studies and
> clean-adoption fixtures now own those maintained evaluation roles.

## Decision

Real Socket.IO remains the behavioral reference. The drawing-game compatibility study
runs its shared workflow against Real Socket.IO and workspace Smocket, while its
maintenance study records staged handwritten implementations. Clean-adoption fixtures
install the exact candidate or reviewed published packages outside the checkout.

Those maintained paths replace the chat-room consumer and case-study runners, fixtures,
observations, and historical interpretation. `examples/chat-room` stays because its
short CLI and dual-target test remain useful executable documentation without owning a
separate package or evidence snapshot.

The reviewed published version lives in `consumers/published-release.json`. This keeps
scheduled registry validation explicit without retaining an application-specific
manifest and lockfile as the release pin.

## Alternatives rejected

- **Keep every evaluation path.** Duplicate package and case-study paths can report old
  versions as current evidence and multiply maintenance without adding a distinct claim.
- **Remove the chat-room example too.** The example still provides a compact program and
  CI smoke path that is separate from independent package and comparison evidence.
- **Delete decisions 0024 and 0027.** Superseding them preserves why the retired structure
  existed and records which maintained paths replaced it.
