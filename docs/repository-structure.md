# Repository structure

> **TL;DR** Production packages live in `src/` and `packages/`; executable workflows
> live in `examples/`, `consumers/`, and `case-studies/`; tests and browser fixtures sit
> beside the boundary they own. Generated files are changed through `scripts/`, not by hand.

## Top-level areas

| Path             | Responsibility                                                           |
| ---------------- | ------------------------------------------------------------------------ |
| `src/`           | Root `smocket` source and delivery-focused dual-run tests.               |
| `packages/`      | Additional published packages, currently `smocket-client`.               |
| `test/`          | Focused cross-file contract suites that exercise a production subsystem. |
| `browser-tests/` | Browser runner fixtures used by lifecycle and parity scripts.            |
| `examples/`      | Runnable applications that use workspace packages.                       |
| `consumers/`     | Projects assembled outside the checkout to verify package adoption.      |
| `case-studies/`  | Reproducible application comparisons and their generated records.        |
| `experiments/`   | Narrow prototypes retained as automated compatibility checks.            |
| `docs/`          | User, maintainer, scope, and decision documentation.                     |
| `website/`       | Docusaurus wrapper, navigation, Markdown integrations, and site tests.   |
| `scripts/`       | Generation, package, release, and browser verification entry points.     |
| `third-party/`   | Vendored license texts and other attributed upstream material.           |
| `.github/`       | Issue forms, pull-request template, and automation workflows.            |

## Test ownership

Delivery and routing cases remain beside the root implementation in `src/` because the
same cases run against Real Socket.IO and Smocket. The SharedWorker host and client
contract suites live in `test/shared-worker/`; source, dist, and Chromium configs all
collect those same files. `browser-tests/` contains pages and workers driven by scripts,
not another Vitest suite.

Examples may own tests for application behavior. Package runtime tests stay inside their
package, while `consumers/test-adoption/` is copied to a temporary directory and installed
without workspace resolution.

## Generated and temporary files

- `docs/conformance.md` has a marked generated region. `pnpm conformance` writes it from
  the dual run; `pnpm check:conformance` only compares.
- `docs/public-surface.generated.json` comes from `pnpm public-surface`; its companion
  ledger remains reviewed prose and classifications.
- Drawing-game files named `*.generated.json` come from the matching `:record` or snippet
  command documented in the [case study](../case-studies/drawing-game/README.md).
- `dist/`, `coverage/`, `website/build/`, `.release-candidate/`, and runner-specific
  temporary directories are outputs. They are not source files to commit.

See [`scripts/README.md`](../scripts/README.md) before running a script directly.
