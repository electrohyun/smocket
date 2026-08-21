# Drawing-game TypeScript example

> **TL;DR** One ordinary Socket.IO drawing and guessing application runs against
> Real Socket.IO 4.8.3 and the workspace Smocket packages. Both targets execute the
> same scenario and assertions, then compare complete normalized observations.

This is the golden source shared by future demo-site, interactive-report, and
live-coding content. It reproduces the workflow verified in `smocket-site` commit
`77bbcb9e5e13ba03eecab20316570f509aa4e990`; it contains no React, canvas, trace,
delay, benchmark, or handwritten-mock code.

## Install and run

From the repository root:

```bash
pnpm install
pnpm example:drawing-game:real
pnpm example:drawing-game:smocket
pnpm example:drawing-game:test
pnpm example:drawing-game:observe
```

The Real target uses an ephemeral loopback port. The Smocket target stays in memory.
`example:drawing-game` is the short alias for the dual-target test. To reproduce the
four package roles outside this workspace, install exact `socket.io@4.8.3` and
`socket.io-client@4.8.3` versions and keep `smocket` and `smocket-client` on the same
exact version.

## Follow the source

1. Start with [`application.ts`](./application.ts): event maps and one normal
   `io.on('connection')` handler own join, stroke, chat, guess, ack, targeted emit,
   and room announce behavior.
2. Read [`client.ts`](./client.ts): it deliberately imports `io` from
   `socket.io-client` and exposes the calls a UI would use.
3. Run [`real.ts`](./real.ts): Node HTTP listens on port `0`, then the same handlers
   serve three independent real clients.
4. Read [`smocket-loader.mjs`](./smocket-loader.mjs): only modules compiled under the
   Smocket target resolve `socket.io-client` as `smocket-client`.
5. Run [`smocket.ts`](./smocket.ts): only server construction, URL registry, and close
   lifecycle differ from the Real target.
6. Follow [`scenario.ts`](./scenario.ts) and [`assertions.ts`](./assertions.ts): both
   targets use the same A/B/C actions, disconnect check, and expected observation.

The Smocket TypeScript config also maps the two Socket.IO type packages to the built
workspace packages. Separate target compilation therefore keeps casts out of the
golden application and client source. The only `as unknown as` casts are inside
[`target.ts`](./target.ts), where target lifecycle code handles test-only barrier and
marker events without adding them to the public application maps. They are not included
in any public snippet.

## What the observation proves

The scenario normalizes random socket ids to `sid_A`, `sid_B`, and `sid_C`, and omits
ports and time. It records connections, acknowledged joins, per-client event order,
payloads, recipients, sender exclusion, guess acknowledgements, targeted delivery,
room announcement, and recipients after C disconnects.

Non-receipt never depends on a short timeout. After each action, its initiating client
sends a test-only barrier over the same client-to-server FIFO stream. The server handles
that barrier only after the action, then broadcasts a marker behind the action's
server-to-client deliveries. Once every connected client receives the marker, an absent
earlier event is deterministically absent.

## Generated content snippets

Run `pnpm example:drawing-game:snippets` to regenerate
[`snippets.generated.json`](./snippets.generated.json), and run
`pnpm example:drawing-game:snippets:check` to fail when it is stale. Marker comments
are excluded from extracted code.

| Content use     | Snippet ids                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Drawing tab     | `room-join`, `drawing-server-handler`, `drawing-client`                                                  |
| Chat tab        | `chat-guess-server-handler`, `chat-guess-client`, `acknowledgement`, `targeted-correct`, `room-announce` |
| Disconnect step | `disconnect-behavior`                                                                                    |
| Real setup      | `real-bootstrap`                                                                                         |
| Smocket setup   | `smocket-bootstrap`, `smocket-client-substitution`                                                       |

The report should use the same ids in workflow order: `room-join`, drawing pair,
chat/guess pair, acknowledgement, targeted correct, room announce, disconnect, then
the two bootstrap snippets. Consumers should read the generated JSON rather than copy
source text by hand.

## Live-coding plan

Prepare the imports, event maps, constants, `registerDrawingGameHandlers` shell,
client factory, scenario, and assertions from the completed files. During recording,
write `drawing-server-handler` and then `chat-guess-server-handler`, whose inner order
is acknowledgement, wrong-guess chat, targeted correct, and room announce. Together
they are 19 source lines after marker comments are excluded. Then run the Real target,
enable the Smocket resolution hook, and run the unchanged scenario again.

This skeleton is not a second codebase: it is the surrounding code in the same golden
files. The completed source is always the executable version tested by the commands
above, and the live-written regions are extracted directly from it.
