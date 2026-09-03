# Stable release roadmap

> **TL;DR** v1.0.0 stabilized the documented in-memory delivery and routing subset,
> its public types, and the two-package substitution path. Milestones own live release
> status; this page owns the durable boundary, gates, validation paths, and non-goals.

## Release boundary

Since v1.0.0, the compatibility guarantee is observable behaviour and public types inside the documented
[scope](./scope.md). The [conformance report](./conformance.md) owns behaviour compared
with Real Socket.IO, [differences](./differences.md) owns deliberate divergences and
Smocket-only APIs, and [ADR 0019](./decisions/0019-what-counts-as-a-breaking-change.md)
governs changes to published promises.

The root and client packages release as one exact-version pair. Their supported imports
are listed in the [package entry-point guide](./package-entry-points.md); a release does
not add another public path merely to make an internal test convenient.

## Release gates

- Each immutable release candidate must pass the dual Node run, supported platforms,
  Chromium, package policy, clean adoption, documentation, conformance, and public-surface
  drift checks for the same commit.
- Required defects inside the published scope must be resolved or explicitly removed
  from that scope through an issue and decision review.
- Package exports, types, scope, differences, and release notes must describe the same
  boundary without treating an unverified behaviour as absent or supported.
- Publication follows the root-before-client order and exact registry verification in
  the [npm runbook](./npm-publication.md).

Milestones carry live release status; this document deliberately carries no test counts,
completion percentages, or duplicated issue status.

## Maintained application paths

The [drawing-game example](../examples/drawing-game/) runs one application with Real
Socket.IO and Smocket in Node and across browser pages. The workspace chat room remains
a compact executable example. Neither application owns a separate recorded comparison;
the [conformance report](./conformance.md) owns the supported compatibility boundary.

Clean-adoption fixtures install candidate or reviewed published packages outside the
checkout. They own the independent package boundary across test runners, module formats,
types, browser use, and the SharedWorker subpaths.

## Outside the roadmap

Network transport and fallback, heartbeat, automatic network reconnection, multi-server
scaling, and binary framing remain outside Smocket's in-memory layer. A test hook may
simulate an application condition without claiming to reproduce those systems.

Additions after v1.0.0 still start from measured Socket.IO behaviour and follow ADR 0019.
Compatible improvements do not become release commitments until an issue or decision
places them in a milestone.

## Direction and tracking

- Current work: [issue tracker]
- Release history and active gates: [milestones] and [releases]
- Development lenses: [Fidelity, Extensibility, Reliability, Productivity, and Sustainability](./development-lenses.md)
- Technical decisions: [decision index](./decisions/README.md)

[issue tracker]: https://github.com/electrohyun/smocket/issues
[milestones]: https://github.com/electrohyun/smocket/milestones
[releases]: https://github.com/electrohyun/smocket/releases
