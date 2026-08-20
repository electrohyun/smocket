# Dual-target chat-room consumer

> **TL;DR** This fixture installs released packages outside the pnpm workspace and
> runs one chat-room scenario against real Socket.IO and Smocket. `npm test` checks
> that both targets produce the same observation.

The walkthrough reuses the application and scenario in
[`examples/chat-room`](../../examples/chat-room/). The consumer runner copies those
files and this fixture into a temporary project outside the checkout, then installs
the exact npm dependencies from this directory.

## Install the four package roles

A standalone project can create the same boundary with:

```bash
npm install -D smocket@0.5.0 smocket-client@0.5.0
npm install -D socket.io@4.8.3 socket.io-client@4.8.3
```

Keep `smocket` and `smocket-client` at the same exact version. The real target uses
the two Socket.IO packages; the in-memory target uses the two Smocket packages.

## Share the application handlers

[`app.js`](../../examples/chat-room/app.js) exports the one `registerHandlers(io)`
function used by both servers. Its handlers join rooms, exclude the sender from a
room broadcast, return acknowledgements, and send disconnect notifications. Runtime
setup stays in [`targets.js`](../../examples/chat-room/targets.js): Socket.IO owns an
HTTP server and client activation, while Smocket owns an in-process URL and needs no
transport setup.

Both target adapters pass their server through the same application boundary:

```js
return createChatApplication({ io, url, close: () => io.close() });
```

`createChatApplication` calls `registerHandlers(io)` and adds only the shared close
lifecycle needed by the scenario.

## Run the same scenario twice

[`dual-target.test.js`](../../examples/chat-room/dual-target.test.js) passes each target
to the unchanged [`scenario.js`](../../examples/chat-room/scenario.js), validates its
expected result, and then compares the complete Socket.IO and Smocket observations.

The scenario waits directly for expected events and acknowledgements. To prove that
the sender and out-of-room client did not receive an earlier broadcast, it sends a
later private marker through the same client delivery stream and waits for that marker.
Per-socket FIFO ordering makes the empty observation meaningful without a timeout.

From the repository root, run the released packages with one command:

```bash
npm run consumer:chat-room:published
```

The runner performs `npm ci`, verifies that both Smocket packages came from the npm
registry at the pinned version, and runs the dual-target test. It also prints the
Smocket transcript after the comparison passes.

## Run packages built from this checkout

After installing dependencies, create and verify both package artifacts with:

```bash
pnpm release:candidate
pnpm check:release-candidate
```

The second command supplies the root and client tarballs from the same immutable
candidate to this consumer. The committed manifest and lockfile remain unchanged.

## What this proves

This walkthrough proves parity only for the exercised chat-room scenario: room joins,
sender exclusion, acknowledgements, a multi-room broadcast, and disconnect delivery.
The generated [dual-run conformance report](../../docs/conformance.md) remains the
source of truth for Smocket's declared Socket.IO compatibility.
