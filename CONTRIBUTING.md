# Contributing to smocket

Thanks for taking the time to contribute.

smocket aims to reproduce the delivery and routing layer of Socket.IO. When you propose a change, it helps a lot if you can also say how real Socket.IO behaves in that situation. Where smocket and Socket.IO disagree, we treat Socket.IO as the reference.

## Getting started

smocket uses [pnpm](https://pnpm.io).

```bash
git clone https://github.com/electrohyun/smocket.git
cd smocket
pnpm install
pnpm test
```

`pnpm test` runs Vitest in watch mode, and it is handy to leave open while you work. There is no dev server to look at, so the test output is the feedback loop.

| Command           | What it does                       |
| ----------------- | ---------------------------------- |
| `pnpm test`       | Run tests in watch mode            |
| `pnpm test --run` | Run tests once                     |
| `pnpm typecheck`  | Type-check without emitting output |

Vitest is a development dependency only. It is not imported from `src/`, and installing smocket does not pull it in. If you add a helper that needs a spy or a fake timer, implementing it directly rather than importing from `vitest` keeps that boundary intact.

## Scope

smocket reproduces the delivery and routing layer: which sockets receive a given event, and why. As currently planned, the following are outside that boundary:

- Reconnection
- Transport fallback
- Heartbeat
- Multi-server setups via the Redis adapter
- Binary encoding

If you have an idea and are not sure whether it fits, please open an issue before writing code. We can work out together how far it can go.

## Where to start

Issues labelled `good first issue` are scoped so that you do not need to understand the whole codebase to finish them. `help wanted` marks work that matters but that nobody is currently working on.

Tests, tooling, CI, and refactoring are all welcome. The Maintenance issue template is the place for those.

## Branches

Work happens on short-lived branches off `main`. There is no `develop` branch.

Branch names follow the commit type of the work:

```
feat/room-join
fix/disconnect-cleanup
test/broadcast-exclusion
docs/usage-examples
chore/ci-typecheck
```

If an issue already exists, `gh issue develop <number> --checkout` creates and checks out a branch in one step.

## Commits

smocket follows [Conventional Commits](https://www.conventionalcommits.org).

```
<type>: <description>
```

| Type       | When to use                                          |
| ---------- | ---------------------------------------------------- |
| `feat`     | A new capability or API                              |
| `fix`      | Behavior that did not match Socket.IO, now corrected |
| `test`     | Test cases, fixtures, parity checks                  |
| `docs`     | README, examples, API documentation                  |
| `refactor` | Restructuring with no change in behavior             |
| `chore`    | Build config, CI, dependencies, tooling              |
| `perf`     | A change made for performance reasons                |

Scopes are not used. smocket is a single package, so `feat:` rather than `feat(core):`.

An imperative description of around 70 characters is plenty. There is no need to put issue numbers in the subject line, since squash merging adds the pull request number for you.

```
feat: add room join and leave
fix: keep room membership after a client disconnects
test: cover broadcast exclusion for the sender
```

## Pull requests

Please open pull requests against `main`. Linking the issue in the body with `Closes #12` will close it on merge.

A few things worth checking before you ask for review:

- Tests pass (`pnpm test --run`)
- Types check (`pnpm typecheck`)
- New behavior has a test that would fail without your change
- Behavior matches real Socket.IO, and you can say where you verified that

The last one matters most here. A test asserting that smocket does what smocket already does does not tell us much, so tests that encode what Socket.IO does are the most useful kind.

Pull requests are squash merged, so there is no need to tidy up your commit history. The pull request title does become the commit message, so following the commit conventions above helps.

## Reporting bugs

Please use the Bug report template. A reproduction snippet is the fastest route to a fix. Delivery bugs are hard to diagnose from a description alone, because the question is always which socket received what, and in which room or namespace.

Setting up the sockets, performing the emit, and noting which socket you expected to receive the event and which one actually did is enough.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
