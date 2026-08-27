# Moderated chat room example

This example is a small scripted chat application with two
[rooms](../../docs/glossary.md#room), participant roles, targeted messages, and a
disconnect notification. It uses the workspace copy of Smocket, so CI exercises
the source under review rather than an installed public release.

The workspace bootstrap deliberately uses the retained root `connect` export. The
dual-target test reuses this application's handlers and scenario with workspace
Smocket and real Socket.IO.

## Participants and channels

- Alice is the moderator and joins `general` and `support`.
- Bob is a participant in `general`.
- Carol is a participant in `support`.

The server owns the moderator fixture:

```js
const moderators = new Set(['alice']);
```

This is demonstration data, not production authentication. A real application
should derive the participant identity and authorization from a verified session
or token. The server never trusts an `auth.role` value supplied by a client.

## Application flow

The shared scenario runs one workflow in a fixed order:

1. Alice, Bob, and Carol connect.
2. Each participant joins the appropriate rooms. Acknowledgements confirm every
   join before the next action begins.
3. After each join, the server sends a private welcome with
   `io.to(socket.id)`.
4. Bob sends a message to `general`; Alice receives it while Bob and Carol do
   not.
5. Bob attempts a moderator announcement and receives a `moderator-only`
   rejection acknowledgement.
6. Alice announces maintenance to both rooms.
7. Alice belongs to both target rooms but receives the union broadcast once.
8. Bob disconnects; Alice receives his `general` departure notification.

## Run it

From the repository root, after `pnpm install`:

```bash
pnpm example:chat-room
```

That command builds Smocket, runs the application test, and then runs the CLI.
To run only the transcript-producing application:

```bash
pnpm --filter chat-room-example start
```

This workspace-backed command exercises the source under review. Independent package
installation is covered by the repository's clean-adoption fixtures.

The transcript is deterministic:

```text
[alice] Welcome to #general.
[alice] Welcome to #support.
[bob] Welcome to #general.
[carol] Welcome to #support.
[alice] Bob in #general: Hello, everyone!
[bob] Announcement rejected: moderator-only
[alice] Alice to #general, #support: Maintenance starts at 18:00.
[bob] Alice to #general, #support: Maintenance starts at 18:00.
[carol] Alice to #general, #support: Maintenance starts at 18:00.
[alice] Bob left #general.
```

## Test it

The application test uses Node's built-in test runner and the same `runScenario`
function as the CLI:

```bash
pnpm --filter chat-room-example test
```

It runs the scenario twice in one process. This checks the application results
and verifies that a repeated run does not depend on state left by the previous run.

## File responsibilities

- `app.js` exports the shared `registerHandlers` function and owns join, message,
  welcome, authorization, announcement, and departure behavior.
- `bootstrap.js` creates the workspace-backed Smocket server and clients, then
  supplies them to the shared scenario.
- `targets.js` supplies real Socket.IO and Smocket runtime setup to the dual-target
  test.
- `scenario.js` creates the three clients, registers observers before actions,
  executes the workflow, returns structured results, formats the transcript, and
  cleans up every client and the server in `finally`.
- `assertions.js` selects the observable result and owns the expected values shared
  by the application test and case-study targets.
- `index.js` prints the transcript returned by the shared scenario.
- `scenario.test.js` asserts the structured result with `node:test` and
  `node:assert`.
- `dual-target.test.js` runs the same scenario against both runtimes and compares
  their complete observations.

## Smocket APIs in the application

- `new Server(url)` and `io.on('connection')` create the chat server and install
  handlers for each participant.
- `connect(url, { auth })` identifies the scripted participant to the server.
  The identity is used only with the server-owned fixture described above.
- `socket.join(room)` records channel membership.
- `emitWithAck(...)` confirms joins, room-message acceptance, announcement
  rejection, and announcement acceptance.
- `io.to(socket.id).emit(...)` sends a welcome to one participant.
- `socket.to(room).emit(...)` sends a room message or departure notification to
  the other members without echoing it to the sender.
- `io.to(['general', 'support']).emit(...)` targets the union of both rooms. A
  socket in both rooms is included once.
- `socket.rooms` is read during `disconnecting` to find the rooms that need a
  departure notification.
- `io.close()` tears down all sockets and unregisters the application origin.

## Why the workflow does not sleep

The scenario registers every listener before starting the action it observes.
Expected deliveries are awaited directly, while application decisions use
[acknowledgements](../../docs/glossary.md#ack) before the next step starts.

Non-receipt and duplicate checks use a later private marker on the same client
delivery stream. Once that marker arrives, per-socket FIFO ordering proves that
an earlier event is no longer in flight. No arbitrary delay or timeout decides
whether Bob or Carol missed the room message, whether Bob's rejected request was
broadcast, or whether Alice received the two-room announcement more than once.

The departure handler uses `disconnecting`, not `disconnect`, because the
server-side socket still contains its current rooms during `disconnecting`.
Socket.IO clears that set before `disconnect`, which would leave the application
without the channels to notify.

## Application example versus conformance

This example shows already-verified APIs working together as one application. It
does not create a new compatibility guarantee. The generated
[dual-run conformance report](../../docs/conformance.md) remains the source of
truth: each behavior listed there is run first against real Socket.IO and then
against Smocket from the same test case.
