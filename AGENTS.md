# AGENTS.md

> **TL;DR** Keep both test targets green, prove non-receipt with the marker
> pattern rather than timeouts, and never re-derive a settled design decision:
> link to `docs/decisions/`. How to write docs lives in docs, not here.

Repo-operation rules for agents and contributors. Start at
[docs/README.md](docs/README.md) for the documentation map, read
[docs/decisions/README.md](docs/decisions/README.md) for the index of design
decisions, and see [docs/CONTRIBUTING-docs.md](docs/CONTRIBUTING-docs.md) for how
to write docs. This file links to those and summarizes none.

## Tests

- The two targets are vitest projects, so `pnpm test` watches both and
  `pnpm vitest run` runs both once.
- `pnpm test:real` and `pnpm test:mock` run one target each, for when a failure
  needs isolating.
- Done means both targets are green. Running one target alone defeats the dual-run
  comparison the project rests on.
- Never assert non-receipt with a timeout. Use the marker pattern in
  `src/test-events.ts`: send a later event and prove ordering instead.
- Adding, renaming, or removing a case changes `docs/conformance.md`. Run
  `pnpm conformance` and commit the result; CI fails when it has drifted. A new
  test file also needs an entry in the area table in
  `scripts/conformance-report.mjs`.
- `pnpm test:browser` runs the mock target in Chromium and needs
  `pnpm exec playwright install chromium` once. Not part of the dual run: a page
  cannot host a socket.io server, so it only asks whether the mock behaves in a
  browser the way it does in Node. Run it when a change touches a host API.

## Delivery behavior

- A change to a delivery rule starts from real socket.io: compare against it
  first, then make the mock match.
- The design is settled in `docs/decisions/`. Do not re-argue a settled decision
  inline; if a change conflicts with one, stop and raise it in an issue.

## Out of scope

These cannot exist in a mock and are out of smocket's lane, so do not implement
them: reconnection behavior reproduction, transport fallback, heartbeat,
multi-server scaling (Redis adapter), and binary encoding.

## Checks and merge

- `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` must pass.
- Merges are rebase, and `main` is branch-protected, so land every change via a PR.

## Commits and PRs

Follow the Commits and Pull requests sections of
[CONTRIBUTING.md](CONTRIBUTING.md). In short: Conventional Commits
(`type: description`), no issue number in the branch or subject line, commits
split by type (`feat` apart from `docs`) with a tidy history before review, since
PRs are rebase merged and every commit lands on `main` as-is, and `Closes #N` in
the PR body. Write commits, PRs, and issues in English.
