# Roadmap to v1.0.0

_Over the 60 lines [CONTRIBUTING-docs](./CONTRIBUTING-docs.md) recommends. #216
requires one public entry point for the guarantee, non-goals, dependencies, decision
points, and release sequence; issues and ADRs still own every detail and status._

> **TL;DR** — This roadmap defines the scope, review gates, dependencies, and
> release sequence on the way to smocket v1.0.0. Issues and decision records own
> the details and status; this page makes their relationship and the public plan visible.

## Direction

smocket reviews development decisions through five lenses: Fidelity, Extensibility,
Reliability, Productivity, and Sustainability. Their durable definitions and current
examples live in [development-lenses.md](./development-lenses.md).

<p align="center">
  <a href="https://github.com/electrohyun/smocket/issues/213">
    <img
      src="https://github.com/user-attachments/assets/25461c2d-27a0-4d53-b040-b21d7ae00f10"
      width="800"
      alt="Five overlapping circles representing smocket's commitments to Fidelity, Extensibility, Productivity, Sustainability, and Reliability, with the smocket mascot at their shared center."
    />
  </a>
</p>

The lenses are decision tools, not a second issue taxonomy or five one-to-one GitHub
labels. The existing `fidelity` label remains for work whose central task is observing
real Socket.IO. Issues otherwise keep their ordinary work-type labels, documented in
[labels.md](./labels.md), and their target milestone.

## The v1.0.0 guarantee

v1.0.0 aims to provide stable observable behaviour and public types within the documented
Socket.IO logic-layer subset. It does not promise to reproduce network transport or every
public Socket.IO API.

[scope.md](./scope.md) owns that boundary. [conformance.md](./conformance.md) owns the
behaviours proved by running the same cases against real Socket.IO and smocket.
[differences.md](./differences.md) owns intentional divergences and smocket-only APIs, and
[ADR 0019](./decisions/0019-what-counts-as-a-breaking-change.md) governs compatibility
judgements for those published promises. An unverified behaviour is not described as
absent or supported.

### Non-goals

The following remain outside the v1.0.0 guarantee because an in-memory implementation has
no real network on which to reproduce them:

- WebSocket or HTTP long-polling transport and transport fallback;
- heartbeat and ping timeout;
- automatic reconnection after a real network failure;
- multi-server delivery, including Redis adapters and `serverSideEmit`;
- binary encoding and Engine.IO framing.

An explicit simulation hook for testing an application's disconnect or reconnect handling
is a separate feature question. Such a hook would not claim to reproduce a real network.

### Review before v1

Before v1.0.0, the project will review the documented guarantee for:

- conformance defects still inside that guarantee;
- missing capabilities required by core use cases;
- public extension points that must be stable before v1;
- divergences that must be documented explicitly; and
- work to defer until after v1 or confirm as a non-goal.

The review evaluates scenarios, not method names alone: return values, event order, error
handling, and state transitions are observable parts of compatibility. A required result
must link to a concrete issue or decision record before it enters the v1.0.0 milestone.

## Classifying and tracking findings

| Finding                                                           | Roadmap treatment                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Confirmed defect inside the v1 guarantee                          | Required; track with an issue and the `v1.0.0` milestone                            |
| Missing capability or extension point required by a core use case | Required candidate; decide in a concrete issue before adding it to the release gate |
| Compatible improvement that does not block existing use           | Optional or post-v1                                                                 |
| Change to a public extension point                                | Decide explicitly before v1; apply ADR 0019                                         |
| Directionally aligned but unnecessary for v1                      | Post-v1                                                                             |
| Outside the documented scope                                      | Explicit non-goal                                                                   |

The [v1.0.0 milestone] is the live list and release gate for required work. Deferred work
with a target version uses that version's milestone; work without one remains in its
existing issue without a release commitment. “Post-v1” promises another review, not
implementation in the next release. Work that decides, reviews, or documents the v1
guarantee may itself use the milestone; areas that are merely unverified do not become
implementation promises by default.

## Dependencies and decision points

Only dependencies that affect release order belong here; issue bodies own their detailed
requirements and progress.

- The application workflow in [#113] and published-package environment in [#208] feed
  the application validation and productivity reports in [#218].
- [Decisions 0022](./decisions/0022-root-socket-names-server-socket.md) and
  [0023](./decisions/0023-client-package-is-a-thin-facade.md) assign the server and client
  package boundaries; their `smocket-client` facade must ship before the v1 public API
  guarantee is finalized.
- [Decision 0025](./decisions/0025-built-in-adapter-observation-stays-rooms-only.md)
  keeps built-in Adapter compatibility at `rooms`; the deferred methods and lifecycle
  events add no v1 implementation dependency without a concrete use case.
- [Decision 0026](./decisions/0026-payloads-cross-a-json-snapshot-boundary.md) defines
  the non-binary payload boundary; [#250] implements it before the v1 guarantee is final.
- [Decision 0028](./decisions/0028-disconnect-true-closes-the-shared-manager-group.md)
  assigns connection-wide namespace teardown to a logical client Manager; [#254]
  implements that lifecycle before the v1 guarantee is final.
- [development-lenses.md](./development-lenses.md) defines the five lenses used during
  review.
- [#213] remains the parent direction discussion for roadmap feedback and new use cases.

## Pre-v1 release sequence

[ADR 0019](./decisions/0019-what-counts-as-a-breaking-change.md) classifies every change.
The roadmap applies its pre-v1 shift without duplicating the decision table.

### v0.5.0

The accumulated changes since the published v0.4.2 declarations include public type
changes that make existing call sites stop compiling. ADR 0019 classifies that as major
and shifts it to a minor before 1.0.0, so the next synchronized release is v0.5.0 rather
than v0.4.3.

The work previously planned for v0.4.3 ships in that required minor. The project freezes
the release as one synchronized `smocket` and `smocket-client` candidate instead of
publishing part of the accumulated work under a patch number.

A conformance correction may change an observed result without withdrawing a project
promise. Its release notes still state the before and after, the governing ADR 0019 row,
and the test that proves the corrected behaviour.

### Stabilization

After v0.5.0, conformance corrections, documentation fixes, and compatible small
improvements use that line's patch releases. Another required pre-v1 minor would prompt
consideration of v0.6.0. The roadmap does not lock intermediate version numbers or release
count in advance.

```mermaid
flowchart TD
    A["v0.4.2"] --> B["Fidelity and extensibility review"]
    B --> C{"Classify findings"}

    C -->|"v1 required · pre-v1 patch"| D["Include in v0.5.0 set"]
    C -->|"v1 required · pre-v1 minor"| E["Freeze v0.5.0 set"]
    C -->|"optional or deferred"| F["Post-v1"]
    C -->|"outside scope"| G["Explicit non-goal"]

    D --> H["v0.5.0 release"]
    E --> H
    H --> K["Stabilization"]
    K --> L["v1.0.0"]
```

## Changing this roadmap

Issues and ADRs remain the source of truth for requirements and technical decisions. To
change a guarantee, non-goal, dependency, or release policy:

1. Record the reason in a concrete issue or ADR.
2. Classify it as required, optional, post-v1, or out of scope.
3. Check its target release and dependencies.
4. Update the issue milestone and this roadmap together.

A new finding is not automatically a v1 requirement. It enters the release only after the
project determines that it affects the published scope or an explicit v1 guarantee.

## Related work

- Direction discussion: [#213]
- Five development lenses: [development-lenses.md](./development-lenses.md)
- This public roadmap: [#216]
- Application validation and productivity reports: [#218]
- Release gate: [v1.0.0 milestone]
- Version compatibility: [ADR 0019](./decisions/0019-what-counts-as-a-breaking-change.md)

[#113]: https://github.com/electrohyun/smocket/issues/113
[#178]: https://github.com/electrohyun/smocket/issues/178
[#208]: https://github.com/electrohyun/smocket/issues/208
[#213]: https://github.com/electrohyun/smocket/issues/213
[#216]: https://github.com/electrohyun/smocket/issues/216
[#218]: https://github.com/electrohyun/smocket/issues/218
[#250]: https://github.com/electrohyun/smocket/issues/250
[#254]: https://github.com/electrohyun/smocket/issues/254
[v1.0.0 milestone]: https://github.com/electrohyun/smocket/milestone/3
