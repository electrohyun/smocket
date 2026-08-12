# Chat-room application case study

> **TL;DR** Real Socket.IO 4.8.3, published Smocket 0.4.2, and a handwritten
> mock produced the same observable result for one moderated chat workflow. Their
> setup and owned code differ; this result applies only to that workflow and does
> not replace Smocket's dual-run conformance guarantee.

## Method

All targets use the same [`app.js`](../examples/chat-room/app.js),
[`scenario.js`](../examples/chat-room/scenario.js), and
[`assertions.js`](../examples/chat-room/assertions.js). Their only integration
difference is each fixture's dependency wiring and `bootstrap.js`; the handwritten
fixture additionally owns the mock implementation being compared. The
[runner](../scripts/run-chat-room-case-study.mjs) assembles every fixture outside the
checkout, performs `npm ci` from its lockfile, and executes the shared
[`observe.js`](../case-studies/chat-room/observe.js), which runs the assertions twice
in one process.

The workflow observes acknowledged room joins and authorization decisions, private
welcomes, room delivery, a multi-room union broadcast, and a disconnect notification.
Listeners register before their actions. Acknowledgements and later per-socket markers,
not delays or timeouts, establish completion and non-receipt.

## Recorded observation

[`observations.json`](../case-studies/chat-room/observations.json) is the canonical
structured record. This page is the authoritative interpretation. The snapshot was
recorded on 2026-08-12 with Node 22.16.0 and npm 11.17.0 on Darwin arm64. Its repository
source revision is `fa90e07e272c7fd0db64ebfd73cbb104664ddb81`, and its SHA-256 is
`414b07fb27b70cc836d8b71d78d63a0f530d2cae28dbd32b60e77462a64f4bad`; the combined
application-source hash is
`e3884c42af5987b4db154c7f13538054e405e12b496803b8d321ac9a409b62d5`.

| Target                                                                           | Exact dependency                            | Authored target JavaScript        | Result                          |
| -------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------- | ------------------------------- |
| [Real Socket.IO](../case-studies/chat-room/fixtures/socket-io/)                  | `socket.io@4.8.3`, `socket.io-client@4.8.3` | 61-line bootstrap                 | assertions pass; repeat matches |
| [Exact published Smocket](../case-studies/chat-room/fixtures/published-smocket/) | `smocket@0.4.2`                             | 28-line bootstrap                 | assertions pass; repeat matches |
| [Handwritten mock](../case-studies/chat-room/fixtures/handwritten/)              | none                                        | 28-line bootstrap + 212-line mock | assertions pass; repeat matches |

Every target produced the transcript and structured event values in the snapshot. No
behavioral disagreement appeared, and no target required a branch in the application,
workflow, or assertions.

## What each target owns

The Socket.IO fixture owns an HTTP server, an ephemeral loopback port, server shutdown,
and client activation options. It is the behavioral reference and the only target that
runs the workflow through a transport.

The published-Smocket fixture owns one exact package dependency and in-memory bootstrap.
Its application and assertion code are unchanged from the other targets.

The handwritten fixture has no package dependency and needs no port. Its mock uses maps
and sets for arbitrary sockets and rooms, a general event registry, union routing,
sender exclusion, acknowledgements, and disconnect cleanup. It contains no expected
output, participant names, or application event results. It omits namespaces,
middleware, reconnection, transport behavior, and every other unexercised Socket.IO API.
This is an author judgment about the smallest honest scope: each modeled behavior is
needed by a shared assertion, while a result-driven fake would encode the answer and a
broader Socket.IO clone would add maintenance unrelated to this workflow.

## Interpretation

For Fidelity, published Smocket did not change the selected application's observable
result relative to real Socket.IO. This says nothing about behavior outside the shared
assertions; [`conformance.md`](./conformance.md) remains authoritative for declared
compatibility.

For Reliability, the runner is repeatable and each recorded target passed twice in one
process. This is one snapshot, not evidence of continued success over time. The recurring
published-package consumer from [ADR 0024](./decisions/0024-assemble-consumer-from-canonical-example.md)
is separate integration evidence.

For Productivity, the table reports physical source lines, including blank and comment
lines, as concrete code surfaces rather than a score. Generated lockfiles are excluded.
The handwritten target is simpler in dependency installation and port setup, while the
real target supplies reference behavior without application-owned mock logic. An
inference, not a measured future result, is that changes to the exercised event or room
semantics may require maintaining the handwritten mock's additional implementation
surface.

## Limitations

The selected scenario is one moderated, two-room workflow, not a representative sample
of every Socket.IO application. The snapshot covers only the recorded package versions,
machine, and runtime. The real target uses a local HTTP server; the other two are
in-memory and therefore provide no transport comparison.

The handwritten boundary reflects the implementation author's scope judgment. Another
application may exercise different behavior or make a different handwritten design
appropriate. Equal results here must not be generalized beyond the assertions in the
snapshot, and the single recorded run must not be described as historical reliability.

## Reproduce and publish

Run all targets with `pnpm case-study:chat-room`, or select one with
`node scripts/run-chat-room-case-study.mjs --target <target>`, where `<target>` is
`socket-io`, `published-smocket`, or `handwritten`. Use
`pnpm case-study:chat-room:check` to compare a fresh run with the snapshot, and use
`pnpm case-study:chat-room:record` only when intentionally replacing it.

The interactive form belongs at `/case-study` in `electrohyun/smocket-site`. It must use
the observation file from a pinned Smocket source commit and verify the file hash above.
It may present these results but may not add conclusions or remove these limitations.
