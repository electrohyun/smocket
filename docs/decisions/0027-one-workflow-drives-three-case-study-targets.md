# 0027. One workflow drives three case-study targets

**Status:** Superseded by [0039](./0039-retire-legacy-chat-room-evaluation.md) · 2026-08-27 · #451
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md),
[0024](./0024-assemble-consumer-from-canonical-example.md)

> **TL;DR** One chat-room workflow and its observable assertions run through
> independent real Socket.IO, exact published Smocket, and handwritten-mock fixtures.
> Smocket owns the recorded evidence and interpretation; the site renders a pinned
> snapshot, and the result applies only to this workflow.

## Decision

The case study shares one chat-room application workflow and one set of observable
assertions across all three targets. Target-specific code is limited to bootstrap and
dependency wiring, so changing the target does not change the behavior being examined.

Real Socket.IO, an exact published Smocket version, and the handwritten mock each run in
an independent fixture. This keeps their package boundaries and setup visible without
creating separate copies of the workflow or assertions.

The handwritten mock implements only the Socket.IO surface that the workflow calls. It
uses general state for sockets, rooms, participants, and event delivery. It must not
hardcode expected output, named participants, or event results, because doing so would
encode the assertions instead of implementing the behavior they exercise.

## Evidence ownership and publication

The Smocket repository owns the canonical structured observations. It also owns the
static Markdown case study, which is authoritative for interpretation, qualifications,
and limitations.

The interactive form lives at `/case-study` in `electrohyun/smocket-site`. It is built
from an observation snapshot pinned to both its source commit and content hash. The page
may present that snapshot interactively, but it does not become another observation or
interpretation source.

## Claim boundary

Agreement or disagreement is evidence only for the observable behavior exercised by
this workflow. It must not be generalized into a claim about Smocket's overall Socket.IO
compatibility; the [dual-run conformance report](../conformance.md) remains authoritative
for that guarantee.

## Alternatives rejected

- **Maintain a workflow or assertions per target.** Target drift would make differences
  ambiguous because the comparison inputs would no longer be identical.
- **Hardcode the handwritten mock or reproduce Socket.IO broadly.** The first embeds the
  expected answer; the second adds behavior the application does not need and distorts
  the maintenance surface being compared.
- **Let the site own observations or interpretation.** Two editable authorities can
  diverge. A commit-and-hash-pinned snapshot keeps the interactive page traceable to the
  repository record.
- **Treat one passing workflow as general compatibility evidence.** The case study does
  not exercise the full declared surface and cannot replace dual-run conformance.
