# 0000. Do not invent what has no source in real socket.io

**Status:** Accepted · 2026-07-28 · #64

> **TL;DR** smocket reproduces only what real socket.io observably does; where a
> question has no source in the real library, smocket adds nothing rather than
> guess. This is the top-level rule the other decisions defer to, so they cite it
> as `Governed by` instead of restating it.

## Decision

smocket fills in only what has a basis in real socket.io. When a question has an
observable answer in the real library, that answer is the reference and smocket
matches it. When it has none, the answer is to add nothing, not to supply a
plausible-looking one.

"No source" and "not verified" are held apart. A behaviour that could not be
confirmed is recorded as unverified; it is never written up as one that does not
exist, because a missing check is not proof of absence. The distinction keeps an
open question open instead of freezing a guess into the record.

This rule sits above the individual API and behaviour decisions, which is why it
is numbered first. Decisions that turn on "this is how socket.io does it," from
connection timing to which [handshake](../glossary.md#handshake) fields are
populated, name this file in a `Governed by` line rather than repeating the
principle.

## Alternatives rejected

- **Fill an unobservable gap with a sensible default.** A plausible guess reads as
  fact once it is in the code, and a reader cannot tell an invented behaviour from
  a copied one, so the mock would drift from socket.io with no record of where.
- **Treat "could not verify" as "does not exist."** Collapsing the two lets an
  unchecked corner be documented as settled, turning the absence of a test into a
  false claim about the real library.
