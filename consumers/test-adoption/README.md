# Clean adoption fixtures

> **TL;DR** Current candidate and published validation install synchronized
> `smocket` and `smocket-client` packages, then map unchanged `socket.io-client`
> application imports to `smocket-client` outside the workspace.

The Vitest suite alias, hoisted per-file mock, Jest `moduleNameMapper`, static namespace,
and browser fixtures all read `SMOCKET_CLIENT_TARGET`. The runner sets that target to
`smocket-client` whenever it receives the client package input, as both current candidate
and published workflows do. The client-package fixtures import `smocket-client` directly
to check its ESM, CommonJS, type, and browser boundaries. Server and server-type fixtures
continue to import `smocket`.

The fallback target is the root `smocket` package only when the runner is invoked without
a client package input. That path preserves validation for historical root-only releases;
it is not the current `0.5.0` published configuration.

These are not workspace packages. `scripts/run-clean-adoption.mjs` copies them into a
temporary directory outside the checkout, installs the selected exact packages, and
reports each input and resolved identity.

The runner pins its fixture tools in its generated manifest. Update those versions
alongside the repository toolchain, then run the candidate and published commands
from the root package.
