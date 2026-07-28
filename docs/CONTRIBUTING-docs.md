# smocket documentation guide (draft)

> Written: 2026-07-28
> Applies to: every new document under `docs/`
> Nature: a working guide. Referenced by both people and Claude Code.

---

## 0. Audience

Write for a developer who knows programming but **may have no socket.io
experience**.

- Assume general concepts are known: language syntax, async, data structures, the
  microtask queue.
- Assume socket.io-specific concepts are not: room, namespace, adapter, ack, and
  the like.

---

## 1. Style

- **Use bullets for enumerations.** Options, field lists, rule lists, and lists of
  alternatives are bullets.
- **Write causation as prose.** "Why this conclusion" is two to four sentences.
  One claim per paragraph.
  - Chopping it into bullets keeps A and B but loses _A, therefore B_, the
    causation. In a decision record that is a loss.
- **Analogies are strictly forbidden.** When an explanation stalls, write a minimal
  code example or one line of real behavior instead.
  - Exception: `room` / `namespace` / `broadcast` / `adapter` and the like are not
    analogies; they are socket.io's real API names. Use them as-is.
  - What is forbidden is inventing a new analogy to explain something.

---

## 2. Terminology

**Principle: never pass a word the reader may not know without handling it. The
default handling is a link, not a definition.**

| Kind                                                                                     | Handling                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| socket.io domain terms (room, namespace, adapter, ack, handshake)                        | Define in `glossary.md`. Each doc links once on first use and never redefines. |
| smocket-specific concepts (delivery fidelity, dual-run, the marker proof, the diff list) | Defined in the doc that owns the concept. Other docs link to it.               |
| Words used only in one doc (seam, claim queue)                                           | One line at first use. This is the case where there is nowhere to link.        |
| General programming terms (microtask, FIFO)                                              | Not explained.                                                                 |

- When a word's category is unclear, **put it in the glossary.** A definition in an
  awkward place beats a duplicated one.
- This rule is what makes the 60-line limit in §5 hold, because definitions are kept
  out of the body.

---

## 3. Content

- **A decision's reasoning starts from "this is how socket.io does it."** In this
  project the first step of any design question is a comparison with the real
  library, and the docs should show that order.
- **Always record the alternatives you rejected.** With only the choice recorded,
  the same argument can reopen; the rejected options are also material for a better
  design in a new argument.
- **Do not delete a rejection reason later found to be wrong; mark it retracted.**
  (The "two retracted rejection reasons" in the decision-1 option-C doc follow this
  form.)
- **Distinguish "not verified" from "does not exist."** Never write that something
  you could not verify does not exist.
- Keep socket.io source quotes short. Where possible, replace a quote with a
  description of the behavior.

---

## 4. Prohibitions

- Keep prohibitions minimal. _"Do not think of an elephant."_
- **Writing state values.** Test counts, pass rates, progress, "currently
  implementing." That is the job of CI and the issues; baked into a doc it becomes a
  lie when a run goes red.
- **Enumerating feature lists.** They must be hand-edited whenever a feature lands,
  and go silently wrong when they are not.

---

## 5. Format

- **Write in English.** For the Korean-version rules, see §7.
- **60 lines per file at most.** Not an absolute rule, but it can be a topic in PR
  review.
- Use relative paths for links.
- Filenames carry the conclusion. `0001-server-not-mockserver.md`
- Do not reuse numbers. A reversed decision keeps its file and changes to
  `Status: Superseded by 00NN`.

---

## 6. The TL;DR block

Every document must open with a TL;DR.

- **Keep it to three lines where you can.** If the conclusion would be cut off, go
  over; prefer completeness to length.
- It holds three things: **what was decided / why / and therefore what this document
  concludes.**
  - The decision and the conclusion differ. `0005`'s decision is "fire
    connect_error"; its conclusion is "this is the one place that deliberately
    differs from real." The latter is the hook into `differences.md`, so it is the
    line you must not cut when short on space.
- Do not add new information the body lacks.

```markdown
# 0005. Missing server: connect_error, immediately, no retry

**Status:** Accepted · 2026-07-22 · #40
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md)

> **TL;DR** — When no server is registered for the origin, smocket fires
> `connect_error` on the next tick and logs to the console. It does not throw,
> and it does not retry. Real socket.io retries forever; this is the one place
> the two deliberately differ.
```

In the draft stage, fill only **TL;DR · Decision · Alternatives rejected**. Leave
Context and Consequences for later.

---

## 7. Korean versions

- The filename is the original plus `.ko`. (`0005-missing-server-behavior.ko.md`)
- Do not split into a `ko/` directory; the pair is lost when a number changes.
- State the original and the base commit at the top.

```markdown
> This is the Korean version of
> [decisions/0005](./0005-missing-server-behavior.md).
> Base: `6a8d0bc`. If the two diverge, the English version is authoritative.
```

- A Korean document is never required. It is written to help Korean readers, and if
  you would like to contribute one, an AI-written version is fine. It may be revised
  in review; contributions are welcome.

---

## 8. File tree

```
docs/
├── README.md            documentation map
├── glossary.md          term definitions (new, per §2; one file, not split, for lookup)
├── scope.md             scope boundary
├── differences.md       what differs from socket.io + what was added that real lacks
├── conformance.md       dual-run · marker · contract subset · coverage
└── decisions/
    ├── README.md        index (one-line TL;DR + related-issues column)
    └── 00NN-*.md
```
