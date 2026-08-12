# Conformance report

> **TL;DR** Every behaviour on this page was measured against a real socket.io server
> and then against smocket, from one test file. The list is generated from that run and
> is written only when both targets pass, so a case is here because it was compared
> rather than because someone claimed it.

## The dual run

A test file here never imports a server directly. It calls `setupServer()` from
[`src/setup-server.ts`](../src/setup-server.ts), which resolves to a real socket.io
server or to smocket depending on `SMOCKET_TARGET`, and the two targets are the two
vitest projects `pnpm test:real` and `pnpm test:mock` run. The test body is the same
either way.

The real target is the oracle, and the order matters. A case is written against it
first, so what the case asserts is socket.io's behaviour and not the mock's. Running
the identical file against smocket then asks one question, whether the same assertion
still holds. That is why a red mock target is read as a divergence located rather than
a test that needs adjusting.

No case asserts non-receipt by waiting. A timeout only says an event had not arrived
yet, and it buys that weak claim with a slow suite. The cases send a later event to the
same socket instead and assert the ordering: once the marker has arrived, anything that
was supposed to precede it would already be there. The helpers are in
[`src/test-events.ts`](../src/test-events.ts).

Both targets run on every push and pull request, across three operating systems, so the
comparison is continuous rather than something last confirmed by hand. The single CI
badge on the [README](../README.md) goes red if either target does.

<!-- conformance:generated start -->

## Verified against real socket.io

Every case below ran against socket.io 4.8.3 first and against smocket second, from the
same test file, and passed on both. Each links to the test that pins it.

### Connection and identity

Pairing a client with its server socket, the id both sides see, and the first emit.

- [both sides have a socket id once connected](../src/connection.test.ts#L7)
- [a socket id is 20 characters of url-safe base64](../src/connection.test.ts#L14)
- [io.on('connection') fires with the connecting server socket](../src/connection.test.ts#L26)
- [io.on('connect') is a synonym for 'connection' on the server](../src/connection.test.ts#L35)
- [a client-to-server emit arrives](../src/connection.test.ts#L46)
- [a client-to-server ack comes back](../src/connection.test.ts#L55)
- [a server-to-client ack comes back](../src/connection.test.ts#L64)

### Rooms

Join and leave, and which members an emit to a room reaches.

- [joining a room receives emits for that room](../src/rooms.test.ts#L7)
- [a client that has not joined does not receive emits for that room](../src/rooms.test.ts#L17)
- [after leaving, a client no longer receives emits for that room](../src/rooms.test.ts#L34)
- [a socket in several rooms receives the emits of each room](../src/rooms.test.ts#L53)
- [every client in the same room receives (fan-out)](../src/rooms.test.ts#L67)

### Broadcast

The broadcast variants and the sockets each one targets or excludes.

- [socket.broadcast.emit goes to everyone except the sender](../src/broadcast.test.ts#L7)
- [io.except(room) goes to everyone not in that room](../src/broadcast.test.ts#L23)
- [to() with an array delivers to the union of the rooms](../src/broadcast.test.ts#L40)
- [chaining to() delivers to the union of the rooms](../src/broadcast.test.ts#L62)
- [the array union delivers only once even when a socket is in several rooms](../src/broadcast.test.ts#L83)
- [the chained union delivers only once even when a socket is in several rooms](../src/broadcast.test.ts#L98)
- [in() is an alias for to()](../src/broadcast.test.ts#L113)
- [socket.except(room) excludes both the sender and that room](../src/broadcast.test.ts#L130)
- [io.to(socketId) delivers only to that socket (its own id room)](../src/broadcast.test.ts#L153)
- [socket.rooms is server-only and reflects its own id and join/leave](../src/broadcast.test.ts#L169)
- [socket.to(room) excludes the sender even when the sender is a member of that room](../src/broadcast.test.ts#L186)
- [io.emit() delivers to everyone connected](../src/broadcast.test.ts#L213)

### Broadcast chaining

Narrowing a broadcast further, and whether the order of the narrowings matters.

- [io.to(room).except(id) sends to the room minus that socket](../src/broadcast-chaining.test.ts#L11)
- [the two orderings of to and except reach the same sockets](../src/broadcast-chaining.test.ts#L29)
- [chaining except twice excludes the union of both](../src/broadcast-chaining.test.ts#L52)
- [a chained call returns a new operator and leaves the original alone](../src/broadcast-chaining.test.ts#L78)
- [socket.to(room).except(id) keeps excluding the sender](../src/broadcast-chaining.test.ts#L103)
- [socket.broadcast.except(id) excludes the sender and that socket](../src/broadcast-chaining.test.ts#L128)
- [in() on the operator is an alias for to()](../src/broadcast-chaining.test.ts#L150)
- [io.of(nsp).to(room).except(id) narrows within that namespace](../src/broadcast-chaining.test.ts#L171)

### Namespaces

What a namespace isolates: connections, emits, rooms, and socket ids.

- [io.of normalizes empty and bare static namespace names](../src/namespace.test.ts#L8)
- [a registered static namespace admits the normalized harness name](../src/namespace.test.ts#L18)
- [an unregistered static namespace is rejected without membership](../src/namespace.test.ts#L27)
- [a client can retry after its static namespace is registered](../src/namespace.test.ts#L50)
- [io.of(nsp).on('connection') fires only for connections on that namespace](../src/namespace.test.ts#L65)
- [io.of(nsp).emit() goes only to clients in that namespace](../src/namespace.test.ts#L81)
- [io.emit() on the default namespace does not reach other namespaces](../src/namespace.test.ts#L97)
- [a room of the same name is separate per namespace](../src/namespace.test.ts#L116)
- [a client attached to two namespaces has a different socket id per namespace](../src/namespace.test.ts#L141)
- [socket.broadcast stays inside the namespace of the sender](../src/namespace.test.ts#L156)

### Acknowledgements

The trailing callback and `emitWithAck`, in both directions.

- [multi-argument ack resolves with the first value](../src/ack.test.ts#L10)
- [the trailing callback receives the sender-side ack](../src/ack.test.ts#L16)
- [calling ack twice runs the sender callback only once](../src/ack.test.ts#L25)
- [emitWithAck stays pending when the peer never acks](../src/ack.test.ts#L41)
- [server-to-client emitWithAck works without a timeout](../src/ack.test.ts#L53)
- [emitWithAck buffers while disconnected and settles after reconnect](../src/ack.test.ts#L59)

### Acknowledgement timeouts

`timeout(ms)` on a single emit, and what a late ack does.

- [the timeout callback receives (null, response) when the ack wins](../src/timeout.test.ts#L12)
- [works server-to-client with the same success shape](../src/timeout.test.ts#L21)
- [the callback gets a single timeout Error when the peer never acks](../src/timeout.test.ts#L30)
- [times out the same way server-to-client](../src/timeout.test.ts#L43)
- [drops a late ack that arrives after the timeout already fired](../src/timeout.test.ts#L56)
- [timeout().emitWithAck resolves with the response when the ack wins](../src/timeout.test.ts#L85)
- [timeout().emitWithAck rejects with the timeout Error on expiry](../src/timeout.test.ts#L91)
- [a callback-less timeout emit still delivers and arms no timer](../src/timeout.test.ts#L99)

### Broadcast acknowledgements

Collecting an ack from every recipient of a broadcast, and answering on expiry.

- [collects every recipient ack and answers (null, responses)](../src/broadcast-timeout.test.ts#L12)
- [orders responses by ack arrival, not by join order](../src/broadcast-timeout.test.ts#L30)
- [answers (Error, partial responses) when a recipient never acks in time](../src/broadcast-timeout.test.ts#L54)
- [invokes the callback exactly once, dropping an ack that arrives after expiry](../src/broadcast-timeout.test.ts#L74)
- [answers (null, []) at once for a broadcast to a room with no recipients](../src/broadcast-timeout.test.ts#L105)
- [socket.broadcast.timeout(ms) collects from everyone except the sender](../src/broadcast-timeout.test.ts#L117)
- [a chained except drops that recipient from the collection, timeout set first](../src/broadcast-timeout.test.ts#L137)
- [a chained except drops that recipient from the collection, timeout set last](../src/broadcast-timeout.test.ts#L164)
- [socket.timeout(ms).to(room) collects from the room, timeout set first](../src/broadcast-timeout.test.ts#L186)

### Connection middleware

`io.use`: admitting a connection, rejecting one, and the order two run in.

- [a pass-through middleware admits the connection and fires connection](../src/middleware.test.ts#L8)
- [the middleware reads the connecting socket handshake](../src/middleware.test.ts#L21)
- [next(err) makes the client observe connect_error with the error message](../src/middleware.test.ts#L34)
- [the rejecting error's data passes through to the client](../src/middleware.test.ts#L45)
- [a rejected connection cleans temporary membership and stays out of the roster](../src/middleware.test.ts#L59)
- [a cancelled connection attempt cannot be admitted by a late middleware callback](../src/middleware.test.ts#L97)
- [io.of(nsp).use() runs only for connections on that namespace](../src/middleware.test.ts#L148)
- [two middlewares run in registration order](../src/middleware.test.ts#L166)
- [an error in the first middleware short-circuits the second](../src/middleware.test.ts#L181)

### Handshake

The handshake fields a mock can source, and how auth and query reach them.

- [the connection handshake carries the fields a mock can source](../src/handshake.test.ts#L7)
- [handshake.auth defaults to an empty object when the client passes none](../src/handshake.test.ts#L21)
- [handshake.auth carries the client-supplied auth object through unchanged](../src/handshake.test.ts#L26)
- [handshake.query stringifies the client-supplied query values](../src/handshake.test.ts#L33)
- [handshake.auth accepts a function form, resolved via its callback](../src/handshake.test.ts#L41)
- [a reconnect replays the client-supplied auth on the fresh socket](../src/handshake.test.ts#L49)

### socket.data

The per-socket store, its isolation, and its lifetime.

- [socket.data is an empty object at connection](../src/socket-data.test.ts#L12)
- [middleware writes to data and a connection handler reads it back](../src/socket-data.test.ts#L17)
- [each socket has its own data](../src/socket-data.test.ts#L33)
- [a reconnection gets a fresh, empty data rather than the previous socket store](../src/socket-data.test.ts#L42)

### Volatile emits

What `volatile` delivers in steady state, and the one window where it drops.

- [a volatile emit is delivered on a connected socket (server to client)](../src/volatile.test.ts#L13)
- [a volatile emit is delivered on a connected socket (client to server)](../src/volatile.test.ts#L20)
- [io.volatile.to(room) routes to the room like a normal broadcast in steady state](../src/volatile.test.ts#L28)
- [socket.volatile.broadcast reaches everyone except the sender in steady state](../src/volatile.test.ts#L45)
- [a volatile emit still carries an ack, which round-trips when delivered](../src/volatile.test.ts#L61)
- [a volatile emit to a recipient still in the pre-connect window is dropped](../src/volatile.test.ts#L72)
- [a volatile emit from a client still in the pre-connect window is dropped](../src/volatile.test.ts#L97)

### Catch-all listeners

`onAny` / `offAny` on both sides, and the events they do not see.

- [a server-side catch-all fires for every incoming event with the name and args](../src/on-any.test.ts#L7)
- [a catch-all runs before the specific listener for the same event](../src/on-any.test.ts#L17)
- [a catch-all does not fire for the reserved disconnect events](../src/on-any.test.ts#L32)
- [offAny(listener) removes one catch-all, offAny() removes all](../src/on-any.test.ts#L45)
- [the same catch-all registered twice fires once per registration](../src/on-any.test.ts#L73)
- [offAny removes one occurrence of a doubly-registered catch-all](../src/on-any.test.ts#L85)
- [a catch-all receives an ack callback as the last argument](../src/on-any.test.ts#L98)
- [a client-side catch-all fires for a server emit](../src/on-any.test.ts#L112)
- [a client catch-all runs before the specific listener for the same event](../src/on-any.test.ts#L125)
- [a client catch-all does not fire for the reserved disconnect event](../src/on-any.test.ts#L140)
- [client offAny(listener) removes one catch-all, offAny() removes all](../src/on-any.test.ts#L153)

### Outgoing catch-all listeners

`onAnyOutgoing` / `offAnyOutgoing`, and where in the send path they fire.

- [a server-side outgoing catch-all fires for a direct emit with the event name and args](../src/on-any-outgoing.test.ts#L12)
- [a client-side outgoing catch-all fires for a client emit](../src/on-any-outgoing.test.ts#L20)
- [a connected volatile emit fires the outgoing catch-all, on both sides](../src/on-any-outgoing.test.ts#L28)
- [the outgoing catch-all runs before the peer receives the event](../src/on-any-outgoing.test.ts#L40)
- [io.emit fires the outgoing catch-all on every recipient socket](../src/on-any-outgoing.test.ts#L55)
- [a broadcast fires the outgoing catch-all on the reached socket, but not the sender](../src/on-any-outgoing.test.ts#L67)
- [the outgoing catch-all does not fire for the disconnect lifecycle](../src/on-any-outgoing.test.ts#L79)
- [the ack callback is stripped from the outgoing catch-all args, for emit and emitWithAck](../src/on-any-outgoing.test.ts#L90)
- [offAnyOutgoing(listener) removes one, offAnyOutgoing() removes all](../src/on-any-outgoing.test.ts#L106)
- [the client side carries offAnyOutgoing too](../src/on-any-outgoing.test.ts#L123)

### Listener removal

`off` and `removeAllListeners`, including the places the two sides disagree.

- [off removes only the named registration](../src/remove-listeners.test.ts#L7)
- [the same callback registered twice is called once per registration](../src/remove-listeners.test.ts#L27)
- [off removes one occurrence of a doubly-registered callback, leaving the rest](../src/remove-listeners.test.ts#L40)
- [removeAllListeners(event) clears every listener for that event only](../src/remove-listeners.test.ts#L54)
- [removeAllListeners() clears listeners for every event](../src/remove-listeners.test.ts#L72)
- [removeAllListeners() clears a disconnect handler, but the socket still tears down](../src/remove-listeners.test.ts#L86)
- [off and removeAllListeners are no-ops for unknown listeners or events](../src/remove-listeners.test.ts#L99)
- [a listener removed during its own dispatch still runs for that dispatch](../src/remove-listeners.test.ts#L107)
- [off removes a once registration by its original listener](../src/remove-listeners.test.ts#L127)
- [off removes a once registration on the client side too](../src/remove-listeners.test.ts#L140)
- [server off removes the last match, leaving the earlier once registration](../src/remove-listeners.test.ts#L158)
- [server off removes the last match, leaving the earlier on registration](../src/remove-listeners.test.ts#L173)
- [client off removes the first match, leaving the later on registration](../src/remove-listeners.test.ts#L188)
- [client off removes the first match, leaving the later once registration](../src/remove-listeners.test.ts#L203)
- [client off removes only the named registration](../src/remove-listeners.test.ts#L221)
- [client removeAllListeners(event) clears that event only](../src/remove-listeners.test.ts#L238)
- [server off(event) without a listener throws](../src/remove-listeners.test.ts#L259)
- [client off(event) without a listener clears that event](../src/remove-listeners.test.ts#L265)
- [removeAllListeners() does not stop room cleanup](../src/remove-listeners.test.ts#L277)
- [removeAllListeners() leaves catch-all listeners in place](../src/remove-listeners.test.ts#L287)

### Disconnect

Room cleanup, the reason each side reports, and what happens to a pending ack.

- [a disconnected socket no longer receives emits for that room](../src/disconnect.test.ts#L7)
- [a room disappears from the adapter when its last member disconnects](../src/disconnect.test.ts#L29)
- [whole-socket cleanup removes the sid from adapter membership](../src/disconnect.test.ts#L53)
- [a disconnected socket cannot join rooms again](../src/disconnect.test.ts#L67)
- [a reconnected socket does not automatically rejoin its previous rooms](../src/disconnect.test.ts#L87)
- [rooms are still present at disconnecting and empty at disconnect](../src/disconnect.test.ts#L114)
- [a pending client.emitWithAck rejects when the connection drops](../src/disconnect.test.ts#L137)
- [a trailing-callback ack is silently discarded when the connection drops](../src/disconnect.test.ts#L149)
- [a pending server.emitWithAck stays pending when the client disconnects](../src/disconnect.test.ts#L167)
- [client.disconnect() reports io client disconnect to the client and client namespace disconnect to the server](../src/disconnect.test.ts#L189)
- [serverSocket.disconnect() reports io server disconnect to the client and server namespace disconnect to the server](../src/disconnect.test.ts#L205)
- [disconnecting carries the same reason and fires before disconnect](../src/disconnect.test.ts#L221)

### Server close

Server-wide teardown, its reasons, and what happens to pending acknowledgements.

- [close invokes its callback and reports when called again](../src/server-close.test.ts#L12)
- [close rejects a connection started immediately before it](../src/server-close.test.ts#L19)
- [close disconnects every namespace with the shutdown reasons](../src/server-close.test.ts#L32)
- [close rejects a pending client emitWithAck](../src/server-close.test.ts#L66)
- [close leaves a pending server emitWithAck pending](../src/server-close.test.ts#L78)
- [close does not cancel an armed server acknowledgement timeout](../src/server-close.test.ts#L102)

### Emitter return values

What `emit` and the listener methods hand back, and which of them chain.

- [the client emit returns the socket, so it chains](../src/emitter-returns.test.ts#L14)
- [a buffered emit returns the socket too, before the connection completes](../src/emitter-returns.test.ts#L19)
- [the server socket emit returns true rather than the socket](../src/emitter-returns.test.ts#L27)
- [the server emit returns true](../src/emitter-returns.test.ts#L34)
- [a namespace emit returns true](../src/emitter-returns.test.ts#L39)
- [a broadcast emit returns true](../src/emitter-returns.test.ts#L44)
- [a timed broadcast emit returns true](../src/emitter-returns.test.ts#L50)
- [a timed server socket emit returns true, where the client one chains](../src/emitter-returns.test.ts#L61)
- [a volatile emit follows its own side: true on the server, the socket on the client](../src/emitter-returns.test.ts#L72)
- [a dropped volatile emit still returns the emitter it was called on](../src/emitter-returns.test.ts#L79)
- [the client listener methods return the socket, so they chain](../src/emitter-returns.test.ts#L91)
- [the server socket listener methods return the socket, so they chain](../src/emitter-returns.test.ts#L104)
- [chained registrations both take effect](../src/emitter-returns.test.ts#L117)
- [a namespace on returns the namespace, so it chains](../src/emitter-returns.test.ts#L132)

## smocket only

These have no oracle to compare against: they cover the API smocket adds
([differences.md
§B](./differences.md#b-what-smocket-adds-that-socketio-has-no-equivalent-for)) and the
internals behind it, so they run the same under both targets. They are listed apart
because nothing about socket.io follows from them.

### connect(url) and the origin registry

Resolving a url to a server, and what the url contributes to the handshake.

- [connect(url) resolves to the server registered for that origin](../src/connect-url.test.ts#L14)
- [handshake.url is the normalized origin the client connected to](../src/connect-url.test.ts#L23)
- [two spellings of one origin resolve to the same server](../src/connect-url.test.ts#L35)
- [the url's query string lands on handshake.query](../src/connect-url.test.ts#L45)
- [connect(url, { auth }) puts the auth object on the handshake](../src/connect-url.test.ts#L58)
- [a function auth holds the pairing until its callback fires](../src/connect-url.test.ts#L66)
- [a function auth is re-evaluated on each connection, including a reconnect](../src/connect-url.test.ts#L86)
- [the url query wins wholesale over the options query when both are given](../src/connect-url.test.ts#L103)
- [the options query is used only when the url carries none](../src/connect-url.test.ts#L115)
- [the url's path selects the namespace](../src/connect-url.test.ts#L123)
- [connect(url) rejects an unregistered namespace without creating membership](../src/connect-url.test.ts#L133)
- [a relative url resolves against location.origin](../src/connect-url.test.ts#L161)
- [connect(url) to an unregistered origin fires connect_error, without throwing](../src/connect-url.test.ts#L179)
- [close unregisters the server so later connect(url) reports a missing server](../src/connect-url.test.ts#L197)
- [closing a replaced server does not unregister its replacement](../src/connect-url.test.ts#L218)
- [the socket from a failed connect still chains](../src/connect-url.test.ts#L230)

### Adapter API

Registering an adapter that changes the routing decision.

- [io.adapter registers a custom adapter that observes the routing decision](../src/adapter.test.ts#L41)
- [a custom adapter can drop a socket from the target set, and per-socket order still holds](../src/adapter.test.ts#L64)
- [registering a custom adapter preserves per-socket delivery order](../src/adapter.test.ts#L92)

### DelayingAdapter

Holding a socket's client-inbound stream so a race can be interleaved on purpose.

- [an emit from a connection handler reaches the client, before the pairing completes](../src/delay-adapter.test.ts#L27)
- [a delayed socket is held on the timer while an undelayed one still arrives next tick](../src/delay-adapter.test.ts#L40)
- [does not delay the server side: a client emit is received on the next tick](../src/delay-adapter.test.ts#L63)
- [preserves order within a delayed socket's stream, and holds it until the delay elapses](../src/delay-adapter.test.ts#L79)
- [a lowered delay does not let a new event overtake one already queued](../src/delay-adapter.test.ts#L99)
- [a new delay applies only to deliveries scheduled after it is set](../src/delay-adapter.test.ts#L120)
- [gates order through the queue, not the timer: only the head is ever scheduled](../src/delay-adapter.test.ts#L141)
- [ignores a non-finite delay rather than storing NaN or Infinity](../src/delay-adapter.test.ts#L177)

### Socket id encoding

The encoder behind the id shape the dual run pins.

- [encodes bytes the way base64url does, url-safe alphabet included](../src/socket-id.test.ts#L13)
- [strips the padding a length off a multiple of three produces](../src/socket-id.test.ts#L23)
- [an id is 15 random bytes run through that encoder](../src/socket-id.test.ts#L31)

### Public entry points

What the package exports, including the `io` name the substitution path needs.

- [connecting pairs the client and server socket with the same id](../src/index.test.ts#L24)
- [exports `io` as socket.io-client's name for connect, so a module swap works](../src/index.test.ts#L34)
- [exports the contract types, so the swap keeps an app annotations to use](../src/index.test.ts#L46)
- [exports a server type that keeps the two smocket-only members](../src/index.test.ts#L88)

<!-- conformance:generated end -->

## Not covered yet

Socket.IO surface in smocket's lane that no case above compares. Absence here means it
has not been measured, not that it is missing from socket.io.

- **Adapter utility methods on a broadcast operator.** `allSockets`, `fetchSockets`,
  `socketsJoin`, `socketsLeave`, and `disconnectSockets` act on the set a broadcast
  would target, which is the routing decision smocket already reproduces.
- **`emitWithAck` on a broadcast operator.** The callback form of collecting every
  recipient's ack is covered; the promise form is not.
- **`socket.send` and `socket.write`.** socket.io's aliases for emitting `message`.
- **`socket.compress(flag)`.** Its effect is transport-only, so what a mock owes here
  is that the chained call still delivers.
- **`socket.use(fn)`.** Per-packet middleware on one socket, which is a different seam
  from the connection middleware `io.use` covered above.
- **`prependAny`, `prependAnyOutgoing`, `listenersAny`, `listenersAnyOutgoing`.** The
  rest of the catch-all surface.
- **Listener introspection.** `listeners`, `listenerCount`, and `eventNames`.
- **Dynamic namespaces.** `io.of(/regex/)` and the `new_namespace` event.

What is deliberately absent instead of merely uncovered is in
[scope.md](./scope.md), and where smocket and socket.io disagree on purpose is in
[differences.md](./differences.md).

## How to add a case

The gaps above are the shortest route into this repository, because a contribution here
is judged mechanically rather than by taste.

1. **Put it in the area file it belongs to** under `src/`. A new file also needs an
   entry in the area table in
   [`scripts/conformance-report.mjs`](../scripts/conformance-report.mjs), which fails
   the run rather than dropping an unlisted file from this page.
2. **Run `pnpm test:real` first.** Red here means the case states something socket.io
   does not do, so the case is wrong and the mock is not involved yet.
3. **Then run `pnpm test:mock`.** Green on the real target and red on the mock is a
   divergence found, not a mistake made, and it arrives with its reproduction already
   written. Open it as an issue or fix the mock to match.
4. **Prove non-receipt with a marker**, never with a timeout. See the dual run above.
5. **Run `pnpm conformance`** and commit the regenerated page. CI runs the same
   generation and fails if this file no longer matches the suite.

## Supported versions

Each row is answered by a CI job rather than by a claim, so the evidence is in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

| Question                              | Answer                                               | Job                   |
| ------------------------------------- | ---------------------------------------------------- | --------------------- |
| Which Node runs the suite             | 22 and 24 on Linux, current LTS on Windows and macOS | `test`                |
| Which Node runs the published package | 20 and up, the floor `engines.node` declares         | `declared node floor` |
| Which socket.io the cases hold for    | 4.7 and 4.8                                          | `real target`         |
| Which browser the mock runs in        | Chromium, mock target only                           | `browser`             |

The socket.io row is what lets the report speak for more than one version. The cases
encode socket.io's behaviour, the `real target` job passes them on both 4.7 and 4.8, and
the ordinary dual run passes the same cases on smocket. A behaviour the two socket.io
versions disagreed on cannot become a shared case, and the compatibility typecheck requires
the contract to admit both measured declarations. The `Server.close()` return difference is
recorded in [differences.md](./differences.md).

The browser row is narrower on purpose. A page cannot host a socket.io server, so there
is no real target to compare against there, and the job asks only whether the mock
behaves in a browser the way it behaves in Node.

## What a version number promises

The number promises fidelity to socket.io, not the result your suite got last week. A
correction that moves the mock toward measured real behaviour is therefore a minor
release even when it turns a passing test red, because the diverging result was never
what the version promised.

- A correction toward measured real behaviour: minor when it changes what is delivered,
  patch when nothing observable moves.
- Newly covered socket.io surface: minor.
- Removing or altering a deliberate divergence from
  [differences.md §A](./differences.md#a-where-smocket-deliberately-differs): major.
  Adding one: no bump, since it documents what was already happening.
- A public type change: minor if existing call sites still compile, major otherwise.
- Raising `engines.node`: major. Lowering it: minor.

Before 1.0.0 every rule applies one place to the right, the way npm reads a `0.x` range.
A release that changes what is delivered also carries its own section in the notes, with
the before and after as results and a link to the case above that pins the new
behaviour. The reasoning is in
[0019](./decisions/0019-what-counts-as-a-breaking-change.md).
