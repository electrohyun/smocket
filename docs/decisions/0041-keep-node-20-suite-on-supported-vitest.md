# 0041. Keep the Node 20 suite on a supported Vitest release

**Status:** Accepted · 2026-09-11 · #494
**Governed by:** [0019](./0019-what-counts-as-a-breaking-change.md)

> **TL;DR** The normal test projects use Vitest 5 on supported Node releases.
> The `dist/` compatibility suite uses Vitest 4 on Node 20.13.0, so the published
> Node range is tested without relying on unsupported runner behavior.

## Decision

The normal dual run, browser checks, coverage, and consumer validation use Vitest 5
on Node 22 or newer. The declared Node floor job keeps its Node 20.0.0 package smoke
checks and its broader `dist/` suite on Node 20.13.0.

Node 20.0.0 can collect the broader suite, but its fake timer cleanup does not
complete. The direct smoke checks therefore cover the exact published floor, while
Node 20.13.0 runs the broader package behavior.

The broader suite invokes Vitest 4 with Vite 6 from the private `compat/node20`
installation. Its configuration has no runtime import from the root Vitest 5
installation. Renovate may update those tools within their supported majors, but it
must not move them to releases that exclude Node 20.13.0.

## Alternatives rejected

- **Run Vitest 5 on Node 20.** Vitest 5 requires Node 22.12 or newer, so a passing run
  would still depend on behavior outside the runner's supported range.
- **Keep only the Node 20.0.0 smoke checks.** Those checks prove package loading and a
  small delivery path, but they do not exercise the broader suite against `dist/`.
- **Raise `engines.node` to Node 22.** The package can run on Node 20, so raising the
  published floor would remove supported consumers to accommodate a development tool.
