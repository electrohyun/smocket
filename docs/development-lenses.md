# Five development lenses

> **TL;DR** Fidelity, Extensibility, Reliability, Productivity, and Sustainability
> are questions for examining smocket's direction, not scores or work labels. Each
> lens highlights one part of maintaining the stable release guarantees without replacing the documents that
> own the project's scope, evidence, differences, and decisions.

The examples below illustrate current practice. They are not a feature inventory or
a claim that work under a lens is complete.

## Fidelity

- **Meaning.** Within smocket's documented [scope](./scope.md), observable behaviour and
  public types should match measured Socket.IO. Unverified behaviour is not guessed, and
  intentional differences are stated, as required by
  [ADR 0000](./decisions/0000-do-not-invent-what-has-no-source.md).
- **Why it matters.** A test double loses value when substituting it for Socket.IO alone
  changes an application's result.
- **Current example.** The [conformance report](./conformance.md) comes from cases run
  against both targets. The [differences list](./differences.md) separates deliberate
  divergences, smocket-only APIs, and known unplanned gaps.

## Extensibility

- **Meaning.** Test-specific capabilities should extend smocket without silently changing
  its default compatible behaviour. Smocket-only surfaces remain distinct and bounded.
- **Why it matters.** A test affordance should not make the default path harder to trust
  or require a core edit for every use case.
- **Current example.** [Adapter registration](./adapter-registration.md) exposes routing,
  while default delivery stays in the core unless an adapter uses the optional scheduling
  hook. `DelayingAdapter` uses it without reordering a socket's stream, as recorded in
  [ADR 0018](./decisions/0018-delivery-scheduling-adapter-hook.md).

## Reliability

- **Meaning.** Reliability means repeatedly verifying promised results after changes. It
  does not mean network stability, which is outside smocket's
  [scope](./scope.md#not-reproduced-reliability--network-layer).
- **Why it matters.** A result checked once can regress as smocket, Socket.IO, runtimes,
  and the test suite change. Its evidence must remain executable and synchronized.
- **Current example.** CI runs shared behaviour cases against both targets. The
  [conformance report](./conformance.md#the-dual-run) is written only after both pass, and
  its check fails when the generated report has drifted from the suite.

## Productivity

- **Meaning.** Smocket aims to reduce the setup and maintenance needed to write, change,
  and understand Socket.IO application tests.
- **Why it matters.** Behavioural accuracy alone does not prove that adopting the mock
  makes a user's testing workflow easier.
- **Current example.** The [test-runner integration guide](./test-runner-integration.md)
  documents how a test can substitute `smocket-client` while the application keeps its
  `socket.io-client` import. The [drawing-game example](../examples/drawing-game/) keeps
  its application handler and browser UI while changing the Node or SharedWorker
  connection bootstrap.

## Sustainability

- **Meaning.** Smocket's public commitments and development practices should remain
  maintainable after v1.0.0.
- **Why it matters.** Unsupported promises eventually separate documentation, tests, and
  runtime behaviour. The project must keep explaining what it supports and how it knows.
- **Current example.** [Scope](./scope.md), [conformance](./conformance.md), and
  [differences](./differences.md) own separate claims; recurring choices live in
  [decision records](./decisions/README.md). [ADR 0019](./decisions/0019-what-counts-as-a-breaking-change.md)
  defines how published promises affect release classification.
