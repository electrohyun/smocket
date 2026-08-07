# 0019. A version number promises fidelity, not the current result

**Status:** Accepted · 2026-08-07 · #115
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** A correction that moves the mock toward measured real behaviour is a minor
> release, even when it turns a passing test red. What is major is a change to something
> this project stated on its own authority: a documented divergence, an incompatible type,
> or the range of Node it runs on.

## Decision

The public surface here is the signatures and the fidelity to socket.io, and the two can
disagree. A broadcast that reached the wrong set of sockets is a defect against socket.io
and a working behaviour to whoever's test recorded the wrong set.

**The version number promises the fidelity.** A result that diverged from measured real
behaviour was never the promise, so restoring it does not withdraw one. Reading it the
other way freezes every measured defect until the next major, which is not a promise a
faithful mock can make. That is [0000](./0000-do-not-invent-what-has-no-source.md)
applied to versioning.

What is major is what this project stated on its own authority: a divergence it chose, a
type it published, the range of Node it declared. Those are ours to promise and ours to
break.

The first row that matches wins, so the three the paragraph above just named are the three
that go on top. Withdrawing something this project declared has to be judged before
anything else, because a withdrawal is nearly always a move toward real socket.io as well
and a fidelity row would otherwise catch it on the way past. Dropping a §A entry means
smocket stopped diverging on purpose, which is a correction toward measured behaviour;
raising `engines.node` usually rides along with one. Judged as corrections they come out a
minor, and the reason for declaring them in the first place was that they are ours to break
rather than ours to quietly improve.

**Declared on our own authority**

| Change                                                                | Bump         |
| --------------------------------------------------------------------- | ------------ |
| Removing or altering a [`differences.md`](../differences.md) §A entry | major        |
| Raising `engines.node`, lowering it                                   | major, minor |
| A public type change that still compiles at existing call sites, else | minor, major |

**Fidelity, and everything else**

| Change                                                                | Bump            |
| --------------------------------------------------------------------- | --------------- |
| A correction toward measured real behaviour with an observable change | minor           |
| A correction toward measured real behaviour with no observable change | patch           |
| Newly covered socket.io surface                                       | minor           |
| Adding a `differences.md` §A entry                                    | none            |
| Changing something the documentation marks unspecified                | patch           |
| A change to a smocket-only API (§B)                                   | ordinary semver |

Read the first table, then the second. A change that matches nothing in the first is judged
entirely by the second, which is the ordinary case.

The first fidelity row does not ride in a patch. The old result was not a promise, but a
green suite can turn red, and a patch is understood as safe to take without reading
anything. It says observable rather than delivered because the two are not the same set:
the return value of `emit` changes nothing about who receives an event, and a caller still
reads it. Anything a user's code can see belongs on that row, whether or not it moved a
packet.

Before 1.0.0 the rules apply one place to the right, as npm reads a `0.x` range: major
becomes minor, minor and patch become patch. They apply from now rather than from the tag,
because the first conformance fix after 1.0 is a poor place to learn a rule decides nothing.

The shift costs a signal. Two rows that differ above 1.0.0 arrive at the same number below
it, so a `0.x` patch can be a delivery correction or a typo in a comment and the number does
not say which. The release notes carry that instead: every release below 1.0.0 names the row
it landed on, so a reader who needs to know reads one line rather than guessing from the
digit that moved. That is one line and it is owed by every `0.x` release, including the ones
that changed nothing a user can see. It adds to the Announcement rules below rather than
standing in for them: a delivery correction still owes the full treatment there, and while
`0.x` lasts it owes the row name on top.

### Announcement

The version number says how much care an upgrade needs, not what moved. A correction that
changes what is delivered also carries, in the release notes, its own section rather than a
line among the rest; the before and after as results (`io.to('room').emit('x')` reached A
and B, and now reaches A, B, and C); and a link to the dual-run test that pins the new
behaviour. A reader should be able to tell in one screen whether their suite is affected.

### Row order, tested against the history

The three `fix:` commits in the history land in three different rows. Two are delivery
corrections and minor: `088bba7` (#80) buffered `emitWithAck` instead of reaching a dead
socket, and `9b0ae90` kept listeners in arrays so a duplicate registration fires twice.

`a7be4fb` is the one that tests the rules rather than confirming them. It dropped
`node:crypto` from `newId`; nothing it delivers changed and the id keeps the shape
[0011](./0011-socket-id-format.md) fixed, so by output alone it is a patch. But moving the
entropy source to `globalThis.crypto` raised the lowest Node the package runs on, and that
is the whole reason the declared table is read first. Reached in the other order it takes
the no-observable-change row and answers patch, which is the answer the rest of this
document argues against. The judgement is retroactive. `engines` was declared later, so at
the time the effect was real and unstated.

The same trap sat under the §A row until the tables were split. Removing a §A entry means
smocket stopped diverging deliberately, which is a correction toward measured behaviour and
an observable one, so a single table with the fidelity rows on top answered minor for the
row that says major. `emit` returning the socket rather than `undefined` (#189) is the case
that surfaced it: it closed a gap rather than a §A entry, and asking which row it took is
what showed the two could not be told apart by a table in that order.

## Alternatives rejected

- **A conformance correction is major.** Corrections are the expected shape of work here, so
  this makes the major number a count of defects found and puts every fix behind a wait,
  which is the freeze the fidelity promise cannot survive.
- **A conformance correction is patch.** Right about the promise, wrong about the effect. A
  patch is taken without reading anything; a delivery change should be read.
- **A pinned version range recommended in the README.** It moves to the reader a cost the
  announcement rule already covers, on a screen meant for someone still deciding to try it.
