# 0043. Follow one declared Socket.IO target per release

**Status:** Accepted · 2026-09-30 · #519
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0019](./0019-what-counts-as-a-breaking-change.md),
[0042](./0042-automerge-only-stable-renovate-patches.md)

> **TL;DR** Each Smocket release targets exact, validated Socket.IO server and client
> versions, following the latest stable releases through manual adoption. Retire 4.7
> support and version aliases; keep examples and consumers pinned and update them by hand.

## Decision

Socket.IO versions can differ within Smocket's supported API: see the historical close
return-type difference in [0020](./0020-close-follows-socket-lifecycle.md) and the acknowledgement type
change in [4.8.4](https://github.com/socketio/socket.io/releases/tag/socket.io%404.8.4).
A shared contract that accepts both declarations proves compatibility with that contract,
not identical types or behavior for each version. A single declared target makes the
reference for reproduction explicit without maintaining several implementations.

Each Smocket release records the exact `socket.io` and `socket.io-client` versions used
to validate its [covered API](../scope.md). Follow the latest stable versions by measuring
their behavior and checking types before adoption. Keep adopted versions fixed for that
release, and publish them in the conformance report and release notes. The initial adopted
target is 4.8.4 for both packages. End the active 4.7 support promise; older releases retain
their recorded targets, without extending that promise to newer Smocket releases.

- **Root validation:** pin exact versions of the two upstream packages. Renovate proposes
  updates for manual review; both test targets and type checks must pass before adoption.
  Recheck version-dependent types and exclusions when changing the target, rather than
  widening contracts solely to accept an older declaration.
- **Type comparison:** remove the separate `socket.io-4.7`, `socket.io-client-4.7`,
  `socket.io-4.8`, and `socket.io-client-4.8` dependencies and their Renovate rules. Keep
  upstream API inventory and type comparisons, using the declared root target as input.
- **Examples and consumers:** keep upstream versions exact. Disable Renovate updates for
  `socket.io` and `socket.io-client` under `examples/` and `consumers/`; other dependencies
  keep their existing rules. When adopting a new target, update these pins manually and
  verify application substitution and package adoption against that target before release.

Socket.IO and Smocket may be updated independently by users. Document the validated
versions so users can choose a matching release; differing versions are unverified unless
explicitly validated. Previous targets have no guaranteed maintenance. A critical Smocket
bug may receive a selective backport: copy the fix to an earlier release and validate it
against that release's original target. A fix validated only on the new target does not
establish a fix for the old one. Record known unresolved bugs and the available upgrade path.

Retain historical evidence when revising 0020, 0029, and
[0021](./0021-event-maps-cross-the-substitution-seam.md) for this target.
Retiring the `Server.close()` entry in `differences.md` §A requires a major release
under 0019. Release notes declare both targets and explain changed behavior and types.

## Alternatives rejected

- **Support the common part of several versions indefinitely.** Exclusions and widened
  types weaken the goal of reproducing a declared version's supported behavior and types.
- **Maintain version profiles or every old release.** The validation cost exceeds our scope.
- **Automatically update or permanently freeze examples and consumers.** Independent bot
  updates bypass target adoption; permanent freezing stops verifying the declared target.
- **Assume new-target fixes repair old releases.** Those releases still need a validated fix.
