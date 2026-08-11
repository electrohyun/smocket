# Issue and pull request labels

> **TL;DR** Five groups: work-type, outside-contribution, pull request size,
> scope and readiness, and triage. Work-type and pull request size are automatic.
> A pull request inherits `good first issue` from a linked closing issue; the
> remaining labels are applied by hand.

The labels already exist on the repository with the colors below. This file is
the record of what they mean and how each one gets applied, so the scheme does
not drift as issues are filed.

## Work-type

Exactly one per issue. Every issue form applies it automatically, so an issue
opened through a form arrives already labeled.

| Label           | Color     | Meaning                                    | Applied by                                  |
| --------------- | --------- | ------------------------------------------ | ------------------------------------------- |
| `bug`           | `#d73a4a` | Something isn't working                    | Bug report form                             |
| `enhancement`   | `#a2eeef` | New feature or request                     | Feature request form                        |
| `documentation` | `#0075ca` | Improvements or additions to documentation | Documentation form                          |
| `refactor`      | `#fbca04` | Code restructuring without behavior change | Maintenance: refactoring form               |
| `test`          | `#0e8a16` | Test coverage and fixtures                 | Maintenance: tests form                     |
| `chore`         | `#bfd4f2` | Tooling, CI, and dependencies              | Maintenance: tooling, CI, dependencies form |

The three kinds of maintenance are separate forms rather than one form with a
type dropdown, so each carries its own work-type label and none needs a label
applied by hand.

On a pull request the same label comes from the title, which already names the
type because titles follow Conventional Commits. `.github/workflows/pr-label.yml`
maps the commit types in [CONTRIBUTING.md](../CONTRIBUTING.md) to the labels
above, keeps exactly one of them on the pull request so a corrected title does
not leave the old one behind, and fails when the title starts with something
that has no label, which is also the check that the title follows the format.

| Commit type | Label           |
| ----------- | --------------- |
| `feat`      | `enhancement`   |
| `fix`       | `bug`           |
| `docs`      | `documentation` |
| `refactor`  | `refactor`      |
| `test`      | `test`          |
| `chore`     | `chore`         |

## Outside-contribution

Applied by hand to issues during triage, on top of a work-type label, to mark
work shaped for someone arriving from outside. A pull request inherits
`good first issue` when it closes an issue carrying that label. `help wanted`
stays on the issue.

| Label              | Color     | Meaning                   |
| ------------------ | --------- | ------------------------- |
| `good first issue` | `#7057ff` | Good for newcomers        |
| `help wanted`      | `#008672` | Extra attention is needed |

## Pull request size

Exactly one per pull request and never applied to an issue. The PR label workflow
adds additions and deletions, applies the matching black label, and replaces it
when the diff changes.

| Label   | Color     | Changed lines |
| ------- | --------- | ------------: |
| `📏 xs` | `#000000` |           0–9 |
| `📏 s`  | `#000000` |         10–49 |
| `📏 m`  | `#000000` |        50–199 |
| `📏 l`  | `#000000` |       200–999 |
| `📏 xl` | `#000000` | 1,000 or more |

## Scope and readiness

Applied by hand during triage, on top of a work-type label. Two of these say what
the work touches, and two say whether it can start. None of them can come from a
Conventional Commits prefix, which carries only the kind of change, so none of
them is applied by `.github/workflows/pr-label.yml`.

| Label            | Color     | Meaning                                     |
| ---------------- | --------- | ------------------------------------------- |
| `fidelity`       | `#c05621` | Answering it means observing real socket.io |
| `breaking`       | `#7b341e` | Major under decision 0019                   |
| `needs decision` | `#ed8936` | A decision is needed before any code        |
| `blocked`        | `#fbd38d` | Cannot start until another issue settles    |

The four share one shade family so the group reads as a group next to the reds,
blues and greens above. The shade within the family carries no meaning.

`fidelity` needs a boundary sharp enough to stop it spreading. Every delivery
change is checked against socket.io, so "was verified against socket.io" would
catch all of them and mark nothing. The line is whether observing socket.io _is_
the work, which holds when the issue cannot be answered from a decision taken
here and only real socket.io settles it.

`breaking` is the label for a change that
[decision 0019](./decisions/0019-what-counts-as-a-breaking-change.md) puts in the
major row. That is removing or altering a [`differences.md`](./differences.md)
§A entry, a public type change that stops existing call sites compiling, and
raising `engines.node`. A conformance correction is not one of these, however
much it moves, which is the point 0019 settles. Before 1.0.0 those changes ship
as minor, so the label marks what was touched rather than which number moved.

`needs decision` does not overlap with the Issues column in
[decisions/README.md](./decisions/README.md). That column is backward-looking,
listing the issues an existing decision record came out of. This label is
forward-looking, on an issue where no record exists yet.

## Triage

Applied by hand to record how an issue was resolved. A question is normally
routed to Discussions by the issue-form configuration rather than filed as an
issue, so `question` is rare on the tracker.

| Label       | Color     | Meaning                                   |
| ----------- | --------- | ----------------------------------------- |
| `question`  | `#d876e3` | Further information is requested          |
| `duplicate` | `#cfd3d7` | This issue or pull request already exists |
| `invalid`   | `#e4e669` | This doesn't seem right                   |
| `wontfix`   | `#ffffff` | This will not be worked on                |
