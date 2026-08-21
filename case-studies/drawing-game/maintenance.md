# Drawing-game delivery maintenance surface

> **TL;DR** A 19-LOC single-client fake is small. Reaching the complete drawing-game
> workflow requires successive rewrites and a 140-LOC four-file source closure.
> Workspace Smocket uses 18 LOC of target integration. Real Socket.IO supplies the
> expected observation and is not assigned a convenience score.

## Question and boundary

The comparison asks how much application-owned delivery source is present as a
handwritten fake grows from one configured response to the unchanged golden
drawing-game workflow. It does not start from a general mock framework.

Every row is a complete implementation in its own source file (or, for the final
workflow, its own four-file closure). The stage runner imports that exact source,
executes its assertions, and then discards it. Later behavior is not installed into
the base through dormant feature ids, routing hooks, room stubs, recipient selectors,
or disconnect extension points.

| Stage                 | Prerequisite          | Added | Removed | Net | Total |
| --------------------- | --------------------- | ----: | ------: | --: | ----: |
| base single client    | none                  |    19 |       0 | +19 |    19 |
| multiple clients      | base single client    |    28 |       7 | +21 |    40 |
| room membership/bcast | multiple clients      |    38 |      25 | +13 |    53 |
| sender exclusion      | room membership/bcast |     5 |       3 |  +2 |    55 |
| acknowledgement       | sender exclusion      |     3 |       3 |   0 |    55 |
| targeted delivery     | acknowledgement       |     6 |       5 |  +1 |    56 |
| disconnect cleanup    | targeted delivery     |    17 |       2 | +15 |    71 |
| full golden workflow  | disconnect cleanup    |   137 |      68 | +69 |   140 |

The additions and deletions come from deterministic diffs of counted source lines;
they are not marker positions inside one final framework. The large final transition
is visible because the workflow needs the package-substitution boundary and fuller
Socket.IO-shaped listener lifecycle that earlier stages do not pre-own.

Absence checks send a barrier from the same client after the tested event. The
server emits a marker only after handling that barrier, so no short timeout decides
that a recipient is absent.

## Reproduce

    pnpm case-study:drawing-game:maintenance:handwritten
    pnpm case-study:drawing-game:maintenance
    pnpm case-study:drawing-game:maintenance:record
    pnpm case-study:drawing-game:maintenance:check
    pnpm case-study:drawing-game:maintenance:snippets
    pnpm case-study:drawing-game:maintenance:snippets:check
    pnpm case-study:drawing-game:test

[maintenance.generated.json](./maintenance.generated.json) contains stage ids,
prerequisites, actual source closures, hashes, additions, deletions, net changes,
totals, code and diff blocks, assertion results, and the three final observations.
[maintenance-snippets.generated.json](./maintenance-snippets.generated.json)
contains the same executable stage source and transition diffs for downstream use.

## Counting and interpretation

The counter first requires source to match Prettier. It excludes blank,
comment-only, snippet-marker, and punctuation-only formatting lines. Test harnesses,
generated JSON, lockfiles, and README files are listed with exclusion reasons.
Shared golden application/client LOC is recorded separately and never contributes
to the target difference.

The result supports two narrow statements: the minimal fake is small, and this
workflow makes the application own more transport source plus several structural
rewrites. It does not show that more LOC necessarily takes more time or produces
lower productivity, reliability, or quality. No stage or count is adjusted to fit
a preferred conclusion, and one workflow cannot establish a universal tool choice.
