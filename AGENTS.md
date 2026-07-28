# AGENTS.md

> **TL;DR** Keep both test targets green, prove non-receipt with the marker
> pattern rather than timeouts, and never re-derive a settled design decision:
> link to `docs/decisions/`. How to write docs lives in docs, not here.

Repo-operation rules for agents and contributors. For how to write documentation,
see [docs/CONTRIBUTING-docs.md](docs/CONTRIBUTING-docs.md); for why the code is
shaped the way it is, read the decision records under `docs/decisions/`. This file
links to both and summarizes neither.

## Tests

- `pnpm test` runs the suite against the real socket.io target.
- `SMOCKET_TARGET=mock pnpm vitest run` (`pnpm test:mock`) runs it against smocket.
- Done means both targets are green. Running one target alone defeats the dual-run
  comparison the project rests on.
- Never assert non-receipt with a timeout. Use the marker pattern in
  `src/test-events.ts`: send a later event and prove ordering instead.

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
(`type: description`), no issue number in the branch or subject line, one commit
per issue (amend rather than stack fixups), and `Closes #N` in the PR body. Write
commits, PRs, and issues in English.
