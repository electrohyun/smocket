# Multi-tab drawing game

> **TL;DR** Run one React drawing game in three Chromium pages. The default mode
> hosts one in-browser Smocket server in a SharedWorker; the Real mode starts a
> Node HTTP server with Socket.IO. Both modes register the same application
> handler and show the same game screen.

The screen and round follow the multi-tab demo from `smocket-site` commit
`a9c5122686dd4bc1cc8d3b450321cbf800dcd6f8`. This example brings over its
drawing surface, guess UI, countdown, player pages, delivery record, mascot,
night-sky asset, mono font, and visible game flow. It does not include Next.js,
landing or case-study routes, marketing navigation, analytics, generated site
files, snapshots, or the earlier handwritten mock comparison.

## Run with Smocket

From the repository root:

```bash
pnpm install
pnpm example:drawing-game
```

Open the printed URL in desktop Chromium. Player A opens first. Select **Open
Player 2**, then select **Open Player 3**; each selection opens one new page.
When A, B, and C are connected, the countdown starts. Draw in A, submit guesses
in B or C, and use `giraffe` to end the round.

The target badge reads `MOCK · SHAREDWORKER`. This path starts no separate
Socket.IO backend process. One in-browser Smocket server owns the session while
the several browser pages keep distinct socket ids.

## Run with Real Socket.IO

Stop the previous command, then run:

```bash
pnpm example:drawing-game:dev:real
```

Follow the same A/B/C actions. The target badge reads `REAL · SOCKET.IO`. Vite's
Node HTTP server now also hosts a real `socket.io@4.8.3` server, and the pages
connect with `socket.io-client@4.8.3`. The application handler, event types,
state rules, React UI, and user actions do not change.

## Source map

| File                                                                                   | Responsibility                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`src/game/events.ts`](./src/game/events.ts)                                           | Framework-independent events and shared game types                             |
| [`src/game/game-state.ts`](./src/game/game-state.ts)                                   | Sessions, players, strokes, guesses, round state, and cleanup                  |
| [`src/game/game-handler.ts`](./src/game/game-handler.ts)                               | Short Socket.IO-shaped join, broadcast, acknowledgement, and round-end flow    |
| [`src/game/application.ts`](./src/game/application.ts)                                 | Connection registration, countdown, state publication, and handler composition |
| [`src/shared-worker.ts`](./src/shared-worker.ts)                                       | `Server` plus `attachSharedWorker` worker bootstrap                            |
| [`src/connections/shared-worker-client.ts`](./src/connections/shared-worker-client.ts) | Page-owned worker plus `connectSharedWorker` connection                        |
| [`src/real-server.ts`](./src/real-server.ts)                                           | Real Socket.IO server attached to a Node HTTP server                           |
| [`src/connections/socket-io-client.ts`](./src/connections/socket-io-client.ts)         | Real `socket.io-client` page connection                                        |
| [`src/ui/GameApp.tsx`](./src/ui/GameApp.tsx)                                           | React game screen and page-specific event list                                 |
| [`verify.mjs`](./verify.mjs)                                                           | The same user actions in three Chromium pages for both modes                   |

The top-level `real.ts`, `smocket.ts`, `scenario.ts`, and `dual-target.test.ts`
keep the smaller Node comparison runnable. Their `application.ts` wrapper calls
the same browser-safe application code with the visible countdown disabled.

## SharedWorker rules

The worker imports `Server` from `smocket` and `attachSharedWorker` from
`smocket/shared-worker`. Each page imports `connectSharedWorker` from
`smocket-client/shared-worker`. No private `src` or `dist` package path is used.

Pages share the in-browser server only when they use the same origin, browser
profile, worker script URL, and worker name. A different origin, profile, URL,
or name creates separate state. Closing or restarting the worker loses its
in-memory sockets, rooms, strokes, and pending acknowledgements.

The application files do not use React, the DOM, `window`, `localStorage`, or
Node-only APIs, so the same functions run inside the worker and the real Node
server. Browser-specific code is limited to the page connections and React UI.

## Record the live-coding scene

Open the Smocket URL with `?recording=1`. It enters the same game and handler,
uses a recording session id, and keeps the target and player badges prominent.
Open B and C with the two buttons in A.

The actual file to type is
[`src/game/game-handler.ts`](./src/game/game-handler.ts), between the
`live-game-handler` markers. That completed region is also generated into
[`snippets.generated.json`](./snippets.generated.json). When the file changes in
development, Vite reloads every open page with a new worker name so the new
handler is used instead of a worker that survived the edit.

For recording only, remove that marked region in the local working tree, type
the same completed code back into the same file, and save. Do not commit the
temporary incomplete state or create another answer file or branch. After the
recording, confirm the tracked file is back to the completed version.

## Automated checks

```bash
pnpm example:drawing-game:test
pnpm example:drawing-game:verify
```

The first command runs the compact game scenario against Real Socket.IO and
Smocket and compares the complete result. The second opens real Chromium pages
A, B, and C for each browser mode. It checks distinct socket ids, the shared
session, countdown, sender-excluded strokes, chat, both guess acknowledgements,
the common end result, a closed page, a refreshed page, and a repeated run with
no previous players left behind.

This example checks in-memory delivery and routing in one desktop Chromium
profile. A real backend must still be tested for network transport,
authentication, reconnection, database access, persistence, cross-device use,
and scaling. Smocket does not replace those checks.
