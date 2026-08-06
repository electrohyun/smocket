# Issue and pull request labels

> **TL;DR** Three groups. Work-type (what kind of change), outside-contribution
> (who it is shaped for), and triage (how it was resolved). The work-type label
> is applied automatically by the issue form. The rest are applied by hand.

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

## Outside-contribution

Applied by hand during triage, on top of a work-type label, to mark issues
shaped for someone arriving from outside.

| Label              | Color     | Meaning                   |
| ------------------ | --------- | ------------------------- |
| `good first issue` | `#7057ff` | Good for newcomers        |
| `help wanted`      | `#008672` | Extra attention is needed |

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
