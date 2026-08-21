# Drawing-game delivery maintenance surface

> **TL;DR** The golden drawing-game workflow runs against fresh Real Socket.IO,
> workspace Smocket, and a generic staged handwritten transport. The generated
> files report application-owned delivery LOC without treating shared drawing or
> chat code as a target difference.

## Question and boundary

The comparison asks how application-owned support changes when one small fake
adds the Socket.IO delivery semantics used by this workflow. Real Socket.IO
supplies expected behavior only; the two LOC targets are Smocket and handwritten.

The handwritten baseline is deliberately direct: one client/server pair,
listener delivery, and one configured response. The later blocks add only:

| Feature id             | Prerequisite     | Golden source                      |
| ---------------------- | ---------------- | ---------------------------------- |
| **multiple-clients**   | base             | drawing-client                     |
| **room-broadcast**     | multiple clients | room-join, room-announce           |
| **sender-exclusion**   | room broadcast   | drawing-server-handler             |
| **acknowledgement**    | base             | acknowledgement, chat-guess-client |
| **targeted-delivery**  | multiple clients | targeted-correct                   |
| **disconnect-cleanup** | sender exclusion | disconnect-behavior                |

Each stage runs with its prerequisite closure. Absence checks send a barrier from
the same client after the tested event; the server emits a marker only after
handling that barrier. No short timeout decides a recipient is absent.

## Reproduce

    pnpm case-study:drawing-game:maintenance:handwritten
    pnpm case-study:drawing-game:maintenance
    pnpm case-study:drawing-game:maintenance:record
    pnpm case-study:drawing-game:maintenance:check
    pnpm case-study:drawing-game:maintenance:snippets
    pnpm case-study:drawing-game:maintenance:snippets:check
    pnpm case-study:drawing-game:test

[maintenance.generated.json](./maintenance.generated.json) contains feature
prerequisites, +N lines, cumulative totals, counted and excluded files, exact
line numbers, executed-stage results, and the three final observations.
[maintenance-snippets.generated.json](./maintenance-snippets.generated.json)
contains actual code and source ranges extracted from executable markers.

## Counting and interpretation

The counter first requires checked-in source to match Prettier. It excludes blank,
comment-only, snippet-marker, and punctuation-only formatting lines. Tests,
scenarios, assertions, generated JSON, lockfiles, and README files are listed with
their exclusion reasons. Shared application/client LOC is recorded separately and
never contributes to the target difference.

A small handwritten fake can be the simplest choice at the baseline. Source grows
when the application takes ownership of socket identity, room routing, sender
exclusion, acknowledgements, targeting, and disconnect cleanup; that growth is not
drawing or chat logic. LOC is a maintenance-surface count, not a claim about
development time, productivity, reliability, or quality. The result applies only
to this workflow and these counting rules, so it is not a universal recommendation
to use Smocket.
