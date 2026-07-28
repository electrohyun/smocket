# 0001. The public class is named Server, not MockServer

**Status:** Accepted · 2026-07-28 · #64

> **TL;DR** smocket's public class is `Server`, not `MockServer`. The package name
> already carries the mock context and a naming-collision review found nothing to
> clash with, so the plain name is the one users import.

## Decision

The public class is named `Server`, with no `Mock` prefix. The import path already
names the package, so `import { Server } from 'smocket'` reads as "smocket's
Server," and a prefix would only repeat, in the type name, what the import
statement has already said.

A naming-collision review backed this up. In a file that also imports real
socket.io's `Server`, the two are told apart with an import alias where needed, and
no real, unavoidable conflict turned up. Mirroring socket.io's own class name also
lets a reader who knows socket.io read smocket's surface without translation.

## Alternatives rejected

- **`MockServer`.** The `Mock` prefix restates the context the package name already
  gives, and lengthens every call site for a distinction the import draws on its
  own.
- **A qualified export only (`smocket.Server`).** Forcing a namespace import for the
  one main class adds ceremony without removing any ambiguity that a plain named
  export leaves.
