# Contributing to smocket

Thanks for taking the time to contribute.

> [!NOTE]
> smocket reached v1.0.0 in August 2026. Public APIs and documented behaviour now follow the
> compatibility rules in [decision 0019](docs/decisions/0019-what-counts-as-a-breaking-change.md).
> Small documentation changes and clear bug fixes can go straight to a pull request. For a new
> feature or a larger change, please align on direction in a related
> [issue](https://github.com/electrohyun/smocket/issues/new/choose) or
> [Discussion](https://github.com/electrohyun/smocket/discussions) first to avoid duplicate work.
>
> The [roadmap](docs/roadmap.md) records the stable release boundary and recurring gates. Current
> work is tracked in the [issue tracker](https://github.com/electrohyun/smocket/issues) and
> [milestones](https://github.com/electrohyun/smocket/milestones).

smocket aims to reproduce the [delivery and routing layer](docs/scope.md) of
[Socket.IO](https://socket.io/). When you propose a change, it helps a lot if you can also say how
real Socket.IO behaves in that situation. Where smocket and Socket.IO disagree, we treat Socket.IO
as the reference.

## Getting started

smocket uses [pnpm](https://pnpm.io). First,
[fork smocket](https://github.com/electrohyun/smocket/fork) on GitHub, then clone your fork.

```bash
git clone https://github.com/YOUR_USERNAME/smocket.git
cd smocket
git remote add upstream https://github.com/electrohyun/smocket.git
pnpm install
pnpm test
```

Push your working branch to your fork, then open a pull request against `main` in the original smocket repository.

`pnpm test` runs [Vitest](https://vitest.dev/) in watch mode, and it is handy to leave open while you work. There is no dev server to look at, so the test output is the feedback loop.

| Command             | What it does                            |
| ------------------- | --------------------------------------- |
| `pnpm test`         | Run tests in watch mode                 |
| `pnpm vitest run`   | Run both test projects once             |
| `pnpm typecheck`    | Type-check without emitting output      |
| `pnpm lint`         | Check code and documentation style      |
| `pnpm format`       | Apply the repository formatting         |
| `pnpm format:check` | Check formatting without changing files |
| `pnpm docs:check`   | Build and test the documentation site   |

Vitest is a development dependency only. It is not imported from `src/`, and installing smocket does not pull it in. If you add a helper that needs a spy or a fake timer, implementing it directly rather than importing from `vitest` keeps that boundary intact.

## Scope

The [scope boundary](docs/scope.md) explains which parts of Socket.IO smocket reproduces and why
network reliability behavior stays outside the project. Features and extension points can still
grow inside that boundary without contradicting Socket.IO behavior.

If you are not sure whether an idea fits, open an
[issue](https://github.com/electrohyun/smocket/issues/new/choose) or start a
[Discussion](https://github.com/electrohyun/smocket/discussions) before writing code.

## Where to contribute

| Situation                                                                                      | Use                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| smocket behaves differently from real Socket.IO                                                | [Bug report](https://github.com/electrohyun/smocket/issues/new?template=bug_report.yml)                                   |
| A required Socket.IO behavior is missing                                                       | [Feature request](https://github.com/electrohyun/smocket/issues/new?template=feature_request.yml)                         |
| A concrete convenience feature or adapter change would help                                    | [Feature request](https://github.com/electrohyun/smocket/issues/new?template=feature_request.yml)                         |
| You want to discuss API direction, a user workflow, or repeated setup and maintenance friction | [Discussion](https://github.com/electrohyun/smocket/discussions)                                                          |
| Documentation is incorrect, incomplete, or hard to find                                        | [Documentation issue](https://github.com/electrohyun/smocket/issues/new?template=documentation.yml)                       |
| Tooling, CI, tests, or refactoring need work                                                   | [Maintenance issue](https://github.com/electrohyun/smocket/issues/new/choose)                                             |
| You want to share a real use case or reproduction without proposing a specific change          | [Discussion](https://github.com/electrohyun/smocket/discussions), or a bug report when it demonstrates incorrect behavior |

A useful report can be short. Describe the situation, the result you expected, and what happened.
You do not need a research plan or a complete implementation before sharing it.

## Where to start

Issues labelled
[`good first issue`](https://github.com/electrohyun/smocket/issues?q=state%3Aopen%20label%3A%22good%20first%20issue%22)
are scoped so that you do not need to understand the whole codebase to finish them.
[`help wanted`](https://github.com/electrohyun/smocket/issues?q=state%3Aopen%20label%3A%22help%20wanted%22)
marks work that matters but that nobody is currently working on.

Tests, tooling, CI, and refactoring are all welcome. Use the
[Maintenance issue templates](https://github.com/electrohyun/smocket/issues/new/choose) for those.

## Commits

smocket follows [Conventional Commits](https://www.conventionalcommits.org).

```
<type>: <description>
```

| Type       | When to use                                                     |
| ---------- | --------------------------------------------------------------- |
| `feat`     | A new capability or API                                         |
| `fix`      | Behavior that did not match Socket.IO, now corrected            |
| `test`     | Test cases, fixtures, [conformance checks](docs/conformance.md) |
| `docs`     | README, examples, API documentation                             |
| `refactor` | Restructuring with no change in behavior                        |
| `chore`    | Build config, CI, dependencies, tooling                         |

Scopes are not used. smocket is a single package, so `feat:` rather than `feat(core):`.

Each type maps to a label, and a pull request is labelled from its title, so a
type outside this table fails the check. See [docs/labels.md](docs/labels.md).

An imperative description of around 70 characters is plenty. There is no need to put issue numbers in the subject line; link the issue from the pull request body instead.

```
feat: add room join and leave
fix: keep room membership after a client disconnects
test: cover broadcast exclusion for the sender
```

## Pull requests

Please open pull requests against `main`. Linking the issue in the body with `Closes #12` will close it on merge.

A few things worth checking before you ask for review:

- Both test projects pass (`pnpm vitest run`)
- Types check (`pnpm typecheck`)
- Lint passes (`pnpm lint`)
- Formatting is current (`pnpm format:check`)
- Documentation changes build and pass their integration checks (`pnpm docs:check`)
- New behavior has a test that would fail without your change
- Behavior matches real Socket.IO, and you can say where you verified that

If `pnpm format:check` fails, run `pnpm format`, review the resulting changes,
and run the check again before pushing.

The last one matters most here. A test asserting that smocket does what smocket already does does not tell us much, so tests that encode what Socket.IO does are the most useful kind. [docs/conformance.md](docs/conformance.md) lists what is already encoded, what is not yet, and the steps a new case goes through; if you added or renamed one, run `pnpm conformance` so that page keeps matching the suite.

Pull requests are squash merged. Use a conventional PR title because it becomes the
single commit title on `main`. Branch commits should remain understandable during review,
but you do not need to rewrite them solely to imitate the final one-commit history.

## Reporting bugs

Please use the [Bug report template](https://github.com/electrohyun/smocket/issues/new?template=bug_report.yml).
A reproduction snippet is the fastest route to a fix. Delivery bugs are hard to diagnose from a
description alone, because the question is always which socket received what, and in which
[room](docs/glossary.md#room) or [namespace](docs/glossary.md#namespace).

Setting up the sockets, performing the emit, and noting which socket you expected to receive the event and which one actually did is enough.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
