# Drawing-game compatibility case study

> **TL;DR** The committed TypeScript drawing-game example supplies a fresh Real
> Socket.IO 4.8.3 oracle. The same six steps run against workspace Smocket and
> executable public-API probes for three other tools, producing regenerated
> observations and source snippets without adding missing delivery semantics.

## Compared targets

Real Socket.IO is the oracle, not a score card. The four cards use these exact inputs:

- workspace `smocket` and `smocket-client` at the exact versions in the recorded
  observation;
- [`mock-socket@9.3.1`](https://www.npmjs.com/package/mock-socket/v/9.3.1);
- [`@mswjs/socket.io-binding@0.2.0`](https://www.npmjs.com/package/@mswjs/socket.io-binding/v/0.2.0)
  with compatible latest `msw@2.15.0` and `socket.io-client@4.8.3`;
- [`socket.io-mock@1.3.2`](https://www.npmjs.com/package/socket.io-mock/v/1.3.2).

Each independent fixture has an exact manifest and npm lockfile. The runner installs it
outside the checkout, verifies every installed direct version, and runs the probe twice.
Package README, installed declarations, installed source, and runtime probes are recorded
as capability evidence. No fixture implements a room registry, delivery layer, socket-id
targeting, acknowledgement transport, or disconnect cleanup that its package lacks.

## Reproduce from the repository root

```bash
pnpm install
pnpm case-study:drawing-game:record
pnpm case-study:drawing-game:snippets
pnpm case-study:drawing-game:check
pnpm case-study:drawing-game:snippets:check
pnpm case-study:drawing-game:test
```

`record` intentionally replaces the machine-readable observation with a fresh run.
`check` reruns all targets and compares every stable field with that record. The host
environment remains descriptive, while source hashes, versions, oracle, cards, statuses,
expected values, actual values, and the base source commit must match.
The recorded commit is the commit that last changed the golden workflow. Per-file hashes
identify the golden code, evaluator, runner, substitution loader, probes, manifests, and
lockfiles, avoiding a generated file that would need to contain the hash of the commit that
contains that same file.

Run one target with one of these commands. A non-oracle target still runs Real Socket.IO
first because its expected values must come from the fresh oracle, not a hand-written copy.

```bash
pnpm case-study:drawing-game:real
pnpm case-study:drawing-game:smocket
pnpm case-study:drawing-game:mock-socket
pnpm case-study:drawing-game:msw-binding
pnpm case-study:drawing-game:socket-io-mock
```

## Workflow and classification

[`schema.mjs`](./schema.mjs) owns the six stable step ids and validates the generated
shape. [`evaluate.mjs`](./evaluate.mjs) derives expected step values from the Real
observation and applies only four statuses:

- `MATCH`: the public API ran and its normalized step equals the oracle;
- `DIFFERENT`: the public API ran but its normalized step differs;
- `UNSUPPORTED`: the step needs a concept or public API the tool does not expose;
- `BLOCKED`: an earlier failed or unsupported step prevents this step from running, with
  `blockedByStepId` identifying that prerequisite.

The Real and Smocket targets reuse the full causal barrier/marker workflow from
[`examples/drawing-game`](../../examples/drawing-game/). Competitor probes never use a
short timeout to claim event non-receipt. `socket.io-mock`, whose event calls are
synchronous, emits the marker through the same public broadcast call and asserts its
completion callback before collecting recipients. The MSW fixture's 200 ms option is the
Socket.IO connection failure result, not an event-absence assertion.

## Generated inputs for UI and reports

[`publication.generated.json`](./publication.generated.json) is the single downstream entry
point. It records stable hashes and JSON locations for the five canonical artifacts, then
indexes workflow steps, target classifications, package versions, source metadata, staged
LOC changes, and every snippet id without copying observation or code payloads.

```bash
pnpm case-study:drawing-game:publication:record
pnpm case-study:drawing-game:publication:check
pnpm case-study:drawing-game:publication:validate
```

`record` rebuilds only the manifest, `check` detects any direct edit or changed canonical
artifact, and `validate` checks its schema and all workflow, stage, target, snippet, hash,
and source-revision references. The manifest contains no timestamp, so repeated generation
from the same five inputs is byte-for-byte stable.

- [`observations.generated.json`](./observations.generated.json) contains the environment,
  source revision and hashes, exact packages and sources, full Real oracle, four cards,
  six expected/actual step values, recipients, payloads, acknowledgements, blockers, and
  evidence.
- [`snippets.generated.json`](./snippets.generated.json) contains `targetId`, `stepId`,
  source file, language, purpose, actual code, source hash, status, and blocker. Its 31
  entries cover all five targets and six steps plus the Smocket client substitution.

Snippet code is extracted from the executable golden source or fixture marker regions.
There is no separately maintained display code. Regeneration followed by the stale check
is the handoff contract for the demo site and interactive report.

## Staged handwritten maintenance surface

The companion [maintenance-surface case study](./maintenance.md) runs eight
independent handwritten implementations, from a minimal single-client response to
the complete golden workflow. It derives behavior from a fresh Real Socket.IO run,
confirms workspace Smocket still agrees, and records deterministic source closures,
LOC diffs, and snippets without changing the public-tool cards above.

These observations apply only to this six-step workflow. `mock-socket` is primarily a
WebSocket mock with limited Socket.IO support, the MSW binding documents missing rooms and
broadcasting, and `socket.io-mock` models one paired socket. A status here is evidence of
that exact execution boundary, not a general quality ranking.
