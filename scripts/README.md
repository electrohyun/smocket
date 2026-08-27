# Repository scripts

> **TL;DR** Prefer the root `package.json` command when one exists. Commands named
> `check` or using `--check` compare without changing tracked files; `record`,
> `--write`, and candidate creation intentionally produce output.

## Generated reports and application records

| Script                                  | Normal entry point                                                 | Mode, output, and source of truth                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conformance-report.mjs`                | `pnpm conformance`, CI: `pnpm check:conformance`                   | The default writes the marked region in `docs/conformance.md`; `--check` compares. Test names plus the area table in this script are the inputs.    |
| `check-public-surface.mjs`              | `pnpm public-surface`, CI: `pnpm check:public-surface`             | `--write` regenerates `docs/public-surface.generated.json`; `--check` compares it and the reviewed ledger against installed Socket.IO declarations. |
| `drawing-game-snippets.mjs`             | `pnpm example:drawing-game:snippets[:check]`                       | Extracts display snippets from the executable example; `--write` changes the generated JSON and `--check` is read-only.                             |
| `run-drawing-game-case-study.mjs`       | `pnpm case-study:drawing-game:{record,check}`                      | Runs the Real oracle and comparison targets; `--write` records observations and `--check` compares with the generated record.                       |
| `drawing-game-case-study-snippets.mjs`  | `pnpm case-study:drawing-game:snippets[:check]`                    | Extracts snippets from the case-study sources; source files, not the JSON, are authoritative.                                                       |
| `run-drawing-game-maintenance.mjs`      | `pnpm case-study:drawing-game:maintenance:{record,check}`          | Runs the staged handwritten study and writes or compares `maintenance.generated.json`.                                                              |
| `drawing-game-maintenance-snippets.mjs` | `pnpm case-study:drawing-game:maintenance:snippets[:check]`        | Writes or compares snippets extracted from the staged source files.                                                                                 |
| `drawing-game-publication.mjs`          | `pnpm case-study:drawing-game:publication:{record,check,validate}` | Builds or validates the generated downstream manifest from the canonical drawing-game records.                                                      |

## Package and release gates

| Scripts                                                                                           | Entry point and responsibility                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assert-no-imports.js`, `check-packed-package.mjs`, `check-self-contained-types.mjs`              | `pnpm check:package` checks the built root package, packed contents, external imports, and consumer type boundaries.                                                             |
| `check-client-package.mjs`, `run-client-attw.mjs`                                                 | `pnpm check:client-package` checks the client facade's manifest, files, runtime, and package typing.                                                                             |
| `release-candidate.mjs`, `check-release-candidate.mjs`                                            | `pnpm release:candidate` creates the ignored two-tarball manifest; `pnpm check:release-candidate` consumes that exact set without publishing.                                    |
| `run-clean-adoption.mjs`, `run-client-package-consumer.mjs`                                       | Candidate and published checks assemble independent consumers outside the checkout. They install packages and remove their temporary projects afterward.                         |
| `published-consumer-version.mjs`                                                                  | The scheduled published-consumer workflow validates and prints the reviewed exact version pin.                                                                                   |
| `check-client-release-order.mjs`, `publish-release-candidate.mjs`, `verify-published-release.mjs` | Release workflow-only gates enforce root-before-client publication and verify the exact registry pair. Publication changes external state and is not a local validation command. |
| `check-published-types.mjs`, `published-type-compatibility.mjs`                                   | Pull-request CI detects synchronized version changes and checks the public type boundary against the base revision.                                                              |

## SharedWorker, browser, and smoke gates

| Script                                      | Entry point and responsibility                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `check-shared-worker-dist-gate.mjs`         | `pnpm check:shared-worker-dist` proves the selected facade tests fail when the built SharedWorker entry is absent. |
| `shared-worker-lifecycle.mjs`               | `pnpm test:shared-worker:lifecycle` drives the production worker and page lifecycle in Chromium.                   |
| `shared-worker-browser-error-self-test.mjs` | `pnpm test:shared-worker:errors` injects expected and unexpected page errors into the lifecycle runner.            |
| `shared-worker-sidecar-parity.mjs`          | `pnpm test:shared-worker:parity` compares three SharedWorker pages with a Real Socket.IO sidecar.                  |
| `browser-error-monitor.mjs`                 | Shared helper used by browser runners to collect and reject unexpected page and console errors.                    |
| `smoke.mjs`                                 | The declared Node-floor CI job runs one built-package room broadcast without invoking the development toolchain.   |
| `real-oracle-loopback.test.ts`              | Vitest tooling test that keeps the Real Socket.IO fixture bound to IPv4 loopback.                                  |

## Script tests and direct execution

Files named `scripts/*.test.ts` are collected only by the mock Vitest project because
they test repository tooling rather than Socket.IO behavior. `check-public-surface.test.mjs`
is run by its package command, while website and case-study `.test.mjs` files use the
Node test runner declared by their owning command.

Run raw scripts only when their package command cannot express the needed target or mode.
The package command also supplies required builds, exact arguments, and CI parity.
