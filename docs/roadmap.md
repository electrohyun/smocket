# Roadmap to v1.0.0

> **TL;DR** v1.0.0 stabilizes the documented in-memory delivery and routing subset,
> its public types, and the two-package substitution path. The milestone owns release
> status; this page owns the durable gates, maintained validation paths, and non-goals.

## Release boundary

The v1 guarantee is observable behaviour and public types inside the documented
[scope](./scope.md). The [conformance report](./conformance.md) owns behaviour compared
with Real Socket.IO, [differences](./differences.md) owns deliberate divergences and
Smocket-only APIs, and [ADR 0019](./decisions/0019-what-counts-as-a-breaking-change.md)
governs changes to published promises.

The root and client packages release as one exact-version pair. Their supported imports
are listed in the [package entry-point guide](./package-entry-points.md); a release does
not add another public path merely to make an internal test convenient.

## Gates before v1

- One immutable release candidate must pass the dual Node run, supported platforms,
  Chromium, package policy, clean adoption, documentation, conformance, and public-surface
  drift checks for the same commit.
- Required defects inside the published scope must be resolved or explicitly removed
  from that scope through an issue and decision review.
- Package exports, types, scope, differences, and release notes must describe the same
  boundary without treating an unverified behaviour as absent or supported.
- Publication follows the root-before-client order and exact registry verification in
  the [npm runbook](./npm-publication.md).

The [v1.0.0 milestone] is the live release gate. This document deliberately carries no
test counts, completion percentages, or duplicated issue status.

## Maintained application paths

The [drawing-game case study](../case-studies/drawing-game/README.md) owns the shared
Real Socket.IO, Smocket, competing-tool, and handwritten application comparisons. The
workspace chat room remains a compact executable example, not a second recorded study.

Clean-adoption fixtures install candidate or reviewed published packages outside the
checkout. They own the independent package boundary across test runners, module formats,
types, browser use, and the SharedWorker subpaths.

## Outside the roadmap

Network transport and fallback, heartbeat, automatic network reconnection, multi-server
scaling, and binary framing remain outside Smocket's in-memory layer. A test hook may
simulate an application condition without claiming to reproduce those systems.

After v1, additions still start from measured Socket.IO behaviour and follow ADR 0019.
Compatible improvements do not become release commitments until an issue or decision
places them in a milestone.

## Direction and tracking

- Direction and priorities: [#213]
- Release gate: [v1.0.0 milestone]
- Development lenses: [Fidelity, Extensibility, Reliability, Productivity, and Sustainability](./development-lenses.md)
- Technical decisions: [decision index](./decisions/README.md)

[#213]: https://github.com/electrohyun/smocket/issues/213
[v1.0.0 milestone]: https://github.com/electrohyun/smocket/milestone/3
