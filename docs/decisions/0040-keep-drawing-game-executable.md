# 0040. Keep drawing game executable; retire recorded comparisons

**Status:** Accepted · 2026-09-02 · #476
**Supersedes:** [0039](./0039-retire-legacy-chat-room-evaluation.md)
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md)

> **TL;DR** Keep the drawing game as executable application documentation against
> Real Socket.IO and Smocket. Retire the competing-tool, handwritten, and generated
> comparison paths; conformance and clean adoption keep their existing roles.

## Decision

`examples/drawing-game` remains the maintained application. Its compact Node workflow
runs against Real Socket.IO and Smocket, while its browser workflow runs the same
application handler through a Node Socket.IO server or an in-browser SharedWorker.

The separate `case-studies/drawing-game` path is retired. The repository no longer owns
competing-tool probes, staged handwritten implementations, recorded observations, or a
generated publication manifest for the public site. The site may explain the two runtime
roles from pinned example source without becoming another compatibility authority.

The dual-run [conformance report](../conformance.md) owns general Socket.IO compatibility.
Clean-adoption fixtures own installation of candidate and published packages outside the
workspace. `examples/chat-room` remains a compact executable example as decided in 0039.

## Alternatives rejected

- **Stabilize the MSW result and keep every report.** This preserves a presentation the
  public site no longer uses and keeps unrelated dependency updates coupled to snapshots.
- **Keep only the competing-tool or handwritten reports.** Either path still creates a
  second application record beside the maintained executable example without owning a
  general compatibility promise.
- **Remove the drawing game with its reports.** The application still demonstrates the
  same handlers in Node, a SharedWorker, and real browser pages, so it keeps a distinct
  executable role.
