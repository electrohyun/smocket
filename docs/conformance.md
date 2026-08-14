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
- [server connection state changes at the same lifecycle boundaries as socket.io](../src/connection.test.ts#L18)
- [a socket id is 20 characters of url-safe base64](../src/connection.test.ts#L49)
- [io.on('connection') fires with the connecting server socket](../src/connection.test.ts#L61)
- [io.on('connect') is a synonym for 'connection' on the server](../src/connection.test.ts#L70)
- [a client-to-server emit arrives](../src/connection.test.ts#L81)
- [a client-to-server ack comes back](../src/connection.test.ts#L90)
- [a server-to-client ack comes back](../src/connection.test.ts#L99)

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

### Local broadcast socket lookup

Fetching existing local server Sockets through canonical room, exclusion, sender, and
namespace selection.

- [io.fetchSockets returns the existing local sockets in connection order](../src/broadcast-management-lookup.test.ts#L7)
- [fetchSockets applies room union, deduplication, and exclusions](../src/broadcast-management-lookup.test.ts#L25)
- [a socket management operator excludes its sender and named rooms](../src/broadcast-management-lookup.test.ts#L44)
- [fetchSockets stays inside its namespace even when room names match](../src/broadcast-management-lookup.test.ts#L57)
- [dynamic parents keep Socket.IO fetchSockets boundaries](../src/broadcast-management-lookup.test.ts#L72)
- [lookup ignores timeout, volatile, and compression delivery modifiers](../src/broadcast-management-lookup.test.ts#L84)

### Local bulk broadcast membership

Joining and leaving rooms synchronously through canonical room, exclusion, sender, and
namespace selection.

- [io.socketsJoin synchronously joins every root Socket](../src/broadcast-management-membership.test.ts#L7)
- [socketsJoin applies room union, deduplication, and exclusions](../src/broadcast-management-membership.test.ts#L20)
- [socketsLeave snapshots the selected set before mutating its target room](../src/broadcast-management-membership.test.ts#L38)
- [a Socket management operator excludes its sender from bulk membership](../src/broadcast-management-membership.test.ts#L54)
- [bulk membership stays inside its namespace](../src/broadcast-management-membership.test.ts#L66)
- [bulk membership ignores delivery modifiers](../src/broadcast-management-membership.test.ts#L78)
- [dynamic parent bulk membership follows Socket.IO and does not reach children](../src/broadcast-management-membership.test.ts#L88)

### Aliases and compression modifiers

`send`, `write`, `open`, `close`, socket `in`, and compression chaining. Compression
packet effects stay outside the transport-free mock boundary.

- [Server and Namespace send and write broadcast message and return their receiver](../src/aliases-compression.test.ts#L22)
- [a dynamic parent sends and writes directly while exposing a compress operator](../src/aliases-compression.test.ts#L54)
- [server and client Socket send aliases emit message once and return their socket](../src/aliases-compression.test.ts#L72)
- [a buffered client send observes outgoing before connect and named delivery](../src/aliases-compression.test.ts#L91)
- [server Socket in aliases to while preserving sender exclusion](../src/aliases-compression.test.ts#L114)
- [compress returns immutable broadcast operators and composes with narrowing](../src/aliases-compression.test.ts#L133)
- [broadcast compress preserves a pending acknowledgement timeout](../src/aliases-compression.test.ts#L204)
- [Socket compress stays fluent through timeout and volatile decorations](../src/aliases-compression.test.ts#L220)
- [client open and close delegate to the lifecycle and keep fluent identity](../src/aliases-compression.test.ts#L234)

### Namespaces

What a namespace isolates: connections, emits, rooms, and socket ids.

- [io.of normalizes empty and bare static namespace names](../src/namespace.test.ts#L8)
- [a registered static namespace admits the normalized connection name](../src/namespace.test.ts#L18)
- [an unregistered static namespace is rejected without membership](../src/namespace.test.ts#L27)
- [a client can retry after its static namespace is registered](../src/namespace.test.ts#L50)
- [io.of(nsp).on('connection') fires only for connections on that namespace](../src/namespace.test.ts#L69)
- [io.of(nsp).emit() goes only to clients in that namespace](../src/namespace.test.ts#L85)
- [io.emit() on the default namespace does not reach other namespaces](../src/namespace.test.ts#L101)
- [a room of the same name is separate per namespace](../src/namespace.test.ts#L120)
- [a client attached to two namespaces has a different socket id per namespace](../src/namespace.test.ts#L145)
- [socket.broadcast stays inside the namespace of the sender](../src/namespace.test.ts#L160)

### Dynamic namespace parents

Parent admission, concrete child lifecycle, setup snapshots, and direct broadcasts.
Narrowed operator construction is covered, while narrowed delivery remains unverified
under [0029](./decisions/0029-narrowed-parent-broadcasts-stay-unverified.md).

- [emits new_namespace synchronously once for static namespaces but not root or parents](../src/dynamic-namespace.test.ts#L7)
- [admits RegExp children, caches them, and attaches manual children to the parent](../src/dynamic-namespace.test.ts#L24)
- [preserves stateful RegExp lastIndex across dynamic admission attempts](../src/dynamic-namespace.test.ts#L45)
- [does not re-evaluate a stateful RegExp parent when reading cached namespaces](../src/dynamic-namespace.test.ts#L65)
- [preserves sticky RegExp lastIndex across dynamic admission attempts](../src/dynamic-namespace.test.ts#L79)
- [resets caller-assigned RegExp lastIndex after a failed manual attachment match](../src/dynamic-namespace.test.ts#L99)
- [uses admission order but the latest duplicate RegExp parent for manual attachment](../src/dynamic-namespace.test.ts#L114)
- [reuses one child for concurrent admission and supports the of listener overload](../src/dynamic-namespace.test.ts#L130)
- [tries function matchers in order with normalized names and auth until one allows](../src/dynamic-namespace.test.ts#L145)
- [rejects an unmatched dynamic namespace as Invalid namespace](../src/dynamic-namespace.test.ts#L178)
- [retries dynamic admission after an earlier matcher rejection](../src/dynamic-namespace.test.ts#L191)
- [dynamic admission reads the current client.auth on a manual retry](../src/dynamic-namespace.test.ts#L209)
- [creates a child before middleware and snapshots parent setup at creation](../src/dynamic-namespace.test.ts#L227)
- [copies the parent connect synonym to a concrete child](../src/dynamic-namespace.test.ts#L264)
- [ignores duplicate client connect calls while async dynamic admission is pending](../src/dynamic-namespace.test.ts#L275)
- [cancels dynamic admission while callback-form auth is unresolved](../src/dynamic-namespace.test.ts#L301)
- [cancels unresolved dynamic matching with shared Manager disconnect(true)](../src/dynamic-namespace.test.ts#L338)
- [continues parent matching after a cancelled parent rejects late](../src/dynamic-namespace.test.ts#L382)
- [reuses one child for concurrent async same-name admissions](../src/dynamic-namespace.test.ts#L437)
- [broadcasts directly across children while child rooms and lifecycle stay isolated](../src/dynamic-namespace.test.ts#L466)
- [exposes narrowed parent operators without selecting their delivery result](../src/dynamic-namespace.test.ts#L501)
- [keeps shared Manager teardown connection-wide across dynamic children](../src/dynamic-namespace.test.ts#L512)
- [uses one concrete child for nextConnection, lookup, and Manager grouping](../src/dynamic-namespace.test.ts#L533)
- [creates a RegExp child when nextConnection observes it before a client connects](../src/dynamic-namespace.test.ts#L550)
- [keeps new_namespace available as an ordinary Socket payload event](../src/dynamic-namespace.test.ts#L567)

### Acknowledgements

The trailing callback and `emitWithAck`, in both directions.

- [multi-argument ack resolves with the first value](../src/ack.test.ts#L10)
- [the trailing callback receives the sender-side ack](../src/ack.test.ts#L16)
- [calling ack twice runs the sender callback only once](../src/ack.test.ts#L25)
- [emitWithAck stays pending when the peer never acks](../src/ack.test.ts#L41)
- [server-to-client emitWithAck works without a timeout](../src/ack.test.ts#L60)
- [emitWithAck buffers while disconnected and settles after reconnect](../src/ack.test.ts#L66)

### Payload serialization

JSON results, snapshot timing, invalid data, and reference isolation.

- [client-to-server payloads use JSON results and snapshot at emit](../src/payload-serialization.test.ts#L14)
- [server-to-client payloads snapshot at emit and decode fresh values](../src/payload-serialization.test.ts#L47)
- [client-to-server ack requests and responses cross independent snapshots](../src/payload-serialization.test.ts#L66)
- [server-to-client ack requests and responses cross independent snapshots](../src/payload-serialization.test.ts#L90)
- [a buffered client payload stays live until outgoing observation and flush](../src/payload-serialization.test.ts#L108)
- [direct outgoing listeners mutate the live source before the snapshot](../src/payload-serialization.test.ts#L128)
- [broadcast snapshots once before outgoing listeners and decodes per recipient](../src/payload-serialization.test.ts#L142)
- [room ack broadcasts snapshot requests and responses per recipient](../src/payload-serialization.test.ts#L174)
- [toJSON and enumerable own properties determine decoded object results](../src/payload-serialization.test.ts#L231)
- [a plain toJSON result keeps an original binary property out of the packet](../src/payload-serialization.test.ts#L253)
- [a broadcast encodes even when its room has no recipients](../src/payload-serialization.test.ts#L267)
- [circular and BigInt payloads fail before delivery in both directions](../src/payload-serialization.test.ts#L273)
- [timeout and connected volatile wrappers use the same payload boundary](../src/payload-serialization.test.ts#L295)

### Acknowledgement timeouts

`timeout(ms)` on a single emit, and what a late ack does.

- [the timeout callback receives (null, response) when the ack wins](../src/timeout.test.ts#L14)
- [works server-to-client with the same success shape](../src/timeout.test.ts#L23)
- [returns the same socket and consumes a direct timeout once, on both sides](../src/timeout.test.ts#L32)
- [keeps a recipient timeout pending across plain and ack-collecting broadcasts](../src/timeout.test.ts#L61)
- [the callback gets a single timeout Error when the peer never acks](../src/timeout.test.ts#L85)
- [times out the same way server-to-client](../src/timeout.test.ts#L98)
- [drops a late ack that arrives after the timeout already fired](../src/timeout.test.ts#L111)
- [timeout().emitWithAck resolves with the response when the ack wins](../src/timeout.test.ts#L140)
- [timeout().emitWithAck rejects with the timeout Error on expiry](../src/timeout.test.ts#L146)
- [server timeout().emitWithAck resolves and rejects with the same one-shot decoration](../src/timeout.test.ts#L154)
- [times out volatile server emits in either modifier order without delivering them](../src/timeout.test.ts#L167)
- [a callback-less timeout emit still delivers and arms no timer](../src/timeout.test.ts#L209)

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
- [socket timeout transfers once to the to operator](../src/broadcast-timeout.test.ts#L204)
- [socket timeout transfers once to the except operator](../src/broadcast-timeout.test.ts#L204)
- [socket timeout transfers once to the broadcast operator](../src/broadcast-timeout.test.ts#L204)

### Broadcast Promise acknowledgements

Awaiting every selected recipient, including timeout errors, snapshots, and wrapper
composition.

- [broadcast emitWithAck resolves responses in acknowledgement arrival order](../src/broadcast-promise-ack.test.ts#L9)
- [untimed broadcast acknowledgement collection keeps the timer race and resolves [] for nobody](../src/broadcast-promise-ack.test.ts#L25)
- [untimed broadcast acknowledgement collection times out when a recipient never acknowledges](../src/broadcast-promise-ack.test.ts#L51)
- [timeout rejection exposes partial responses and late acknowledgements mutate that array once](../src/broadcast-promise-ack.test.ts#L68)
- [server, namespace, room, exclusion, and socket broadcast share Promise collection](../src/broadcast-promise-ack.test.ts#L101)
- [timeout-first and narrowing-first Promise broadcasts select the same responders](../src/broadcast-promise-ack.test.ts#L131)
- [Promise broadcast hides its collector ack and observes each selected socket once](../src/broadcast-promise-ack.test.ts#L147)
- [reserved Promise broadcasts reject without outgoing observation](../src/broadcast-promise-ack.test.ts#L157)
- [dynamic parent Promise acknowledgements resolve [] without reaching concrete children](../src/broadcast-promise-ack.test.ts#L168)
- [Promise broadcast snapshots one request and each acknowledgement response independently](../src/broadcast-promise-ack.test.ts#L187)

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

### Server Socket packet middleware

Per-packet ordering, mutation, acknowledgements, rejection, and independent asynchronous
continuation.

- [registers per-socket middleware in order and returns the same socket](../src/socket-middleware.test.ts#L7)
- [runs incoming catch-alls before middleware and exposes packet mutation downstream](../src/socket-middleware.test.ts#L32)
- [keeps the acknowledgement callback in the mutable middleware packet](../src/socket-middleware.test.ts#L63)
- [snapshots middleware when each packet begins processing](../src/socket-middleware.test.ts#L75)
- [lets a later packet complete while earlier packet middleware is held](../src/socket-middleware.test.ts#L101)
- [short-circuits on next(error), emits that Error, and does not acknowledge](../src/socket-middleware.test.ts#L135)
- [does not dispatch a held packet after the socket disconnects](../src/socket-middleware.test.ts#L167)

### Handshake

The handshake fields a mock can source, and how auth and query reach them.

- [the connection handshake carries the fields a mock can source](../src/handshake.test.ts#L7)
- [handshake.auth defaults to an empty object when the client passes none](../src/handshake.test.ts#L21)
- [handshake.auth carries the client-supplied auth object through unchanged](../src/handshake.test.ts#L26)
- [handshake.query stringifies the client-supplied query values](../src/handshake.test.ts#L33)
- [handshake.auth accepts a function form, resolved via its callback](../src/handshake.test.ts#L41)
- [a reconnect replays the client-supplied auth on the fresh socket](../src/handshake.test.ts#L49)
- [a reconnect reads a replacement object from client.auth](../src/handshake.test.ts#L66)
- [a reconnect re-evaluates the current callback from client.auth](../src/handshake.test.ts#L82)

### socket.data

The per-socket store, its isolation, and its lifetime.

- [socket.data is an empty object at connection](../src/socket-data.test.ts#L12)
- [middleware writes to data and a connection handler reads it back](../src/socket-data.test.ts#L17)
- [each socket has its own data](../src/socket-data.test.ts#L33)
- [a reconnection gets a fresh, empty data rather than the previous socket store](../src/socket-data.test.ts#L42)

### Volatile emits

What `volatile` delivers in steady state, and the one window where it drops.

- [a volatile emit is delivered on a connected socket (server to client)](../src/volatile.test.ts#L13)
- [a volatile emit is delivered on a connected socket (client to server)](../src/volatile.test.ts#L22)
- [io.volatile.to(room) routes to the room like a normal broadcast in steady state](../src/volatile.test.ts#L32)
- [socket.volatile.broadcast reaches everyone except the sender in steady state](../src/volatile.test.ts#L49)
- [io.to(room).volatile and io.volatile.to(room) preserve the same target](../src/volatile.test.ts#L65)
- [namespace narrowing and volatile preserve each other in either order](../src/volatile.test.ts#L87)
- [socket.to(room).volatile and socket.volatile.to(room) keep sender exclusion](../src/volatile.test.ts#L114)
- [socket.broadcast.volatile and socket.volatile.broadcast keep sender exclusion](../src/volatile.test.ts#L137)
- [volatile stays immutable and survives to, in, except, and timeout in either order](../src/volatile.test.ts#L158)
- [a volatile emit still carries an ack, which round-trips when delivered](../src/volatile.test.ts#L189)
- [volatile emitWithAck delivers and fires outgoing catch-alls in both directions](../src/volatile.test.ts#L200)
- [a volatile emit to a recipient still in the pre-connect window is dropped](../src/volatile.test.ts#L215)
- [a volatile emit from a client still in the pre-connect window is dropped](../src/volatile.test.ts#L247)
- [consumes volatile once when the same server socket reference is reused](../src/volatile.test.ts#L280)
- [keeps a recipient volatile flag pending across an unrelated broadcast](../src/volatile.test.ts#L300)
- [transfers a server volatile flag once to the to operator](../src/volatile.test.ts#L328)
- [transfers a server volatile flag once to the except operator](../src/volatile.test.ts#L328)
- [transfers a server volatile flag once to the broadcast operator](../src/volatile.test.ts#L328)

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
- [server prependAny listeners run newest-first before onAny listeners](../src/on-any.test.ts#L179)
- [client prependAny listeners run newest-first before onAny listeners](../src/on-any.test.ts#L193)
- [server listenersAny is live and offAny removes the first matching duplicate](../src/on-any.test.ts#L207)
- [client listenersAny is live and offAny removes the first matching duplicate](../src/on-any.test.ts#L228)
- [offAny replaces both sides backing arrays and detaches earlier lookups](../src/on-any.test.ts#L249)
- [incoming catch-all dispatch snapshots listener mutations on both sides](../src/on-any.test.ts#L275)
- [a client incoming catch-all receives the server ack callback](../src/on-any.test.ts#L316)
- [empty listenersAny lookups are fresh and cannot install listeners on either side](../src/on-any.test.ts#L332)
- [offAny on untouched sockets keeps empty lookups fresh and inert](../src/on-any.test.ts#L366)
- [offAny detaches the old arrays and installs stable empty replacements](../src/on-any.test.ts#L401)

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
- [server prependAnyOutgoing listeners run newest-first before onAnyOutgoing listeners](../src/on-any-outgoing.test.ts#L134)
- [client prependAnyOutgoing listeners run newest-first before onAnyOutgoing listeners](../src/on-any-outgoing.test.ts#L146)
- [server listenersAnyOutgoing is live and removes the first matching duplicate](../src/on-any-outgoing.test.ts#L158)
- [client listenersAnyOutgoing is live and removes the first matching duplicate](../src/on-any-outgoing.test.ts#L176)
- [offAnyOutgoing replaces both sides backing arrays and detaches earlier lookups](../src/on-any-outgoing.test.ts#L194)
- [outgoing catch-all dispatch snapshots listener mutations on both sides](../src/on-any-outgoing.test.ts#L217)
- [the client outgoing catch-all omits ack callbacks for emit and emitWithAck](../src/on-any-outgoing.test.ts#L249)
- [empty listenersAnyOutgoing lookups are fresh and cannot install listeners on either side](../src/on-any-outgoing.test.ts#L271)
- [offAnyOutgoing on untouched sockets keeps empty lookups fresh and inert](../src/on-any-outgoing.test.ts#L292)
- [offAnyOutgoing detaches the old arrays and installs stable empty replacements](../src/on-any-outgoing.test.ts#L314)

### Reserved event names

Which public emit names throw before delivery or outgoing observation.

- [server emit surfaces reject the six reserved names and accept application events](../src/reserved-events.test.ts#L29)
- [client emit surfaces reject the six reserved names and accept application events](../src/reserved-events.test.ts#L50)
- [client wrappers reject reserved names while the connection is still pending](../src/reserved-events.test.ts#L60)
- [rejected server emits reach neither the peer nor outgoing catch-alls](../src/reserved-events.test.ts#L90)
- [rejected client emits reach neither the peer nor outgoing catch-alls](../src/reserved-events.test.ts#L119)
- [emitWithAck rejects reserved names without firing outgoing catch-alls](../src/reserved-events.test.ts#L147)
- [connection and new_namespace remain ordinary public payload event names](../src/reserved-events.test.ts#L169)

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

### Listener introspection

Side-specific snapshots, live arrays, counts, names, and once wrappers.

- [a fresh server socket exposes only its internal error listener](../src/listener-introspection.test.ts#L6)
- [server listeners are fresh snapshots with duplicates and unwrapped once callbacks](../src/listener-introspection.test.ts#L19)
- [server listenerCount filters direct and once registrations for string and symbol names](../src/listener-introspection.test.ts#L39)
- [server event names delete empty keys and reinsert them at the end](../src/listener-introspection.test.ts#L69)
- [client listeners expose the live array and component-emitter once wrapper](../src/listener-introspection.test.ts#L93)
- [client last-off and once exhaustion empty and detach the old backing array](../src/listener-introspection.test.ts#L131)
- [client introspection is available before connect for reserved events](../src/listener-introspection.test.ts#L162)

### Disconnect

Room cleanup, the reason each side reports, and what happens to a pending ack.

- [a disconnected socket no longer receives emits for that room](../src/disconnect.test.ts#L7)
- [client connected and disconnected remain exact inverses across teardown](../src/disconnect.test.ts#L29)
- [a room disappears from the adapter when its last member disconnects](../src/disconnect.test.ts#L45)
- [whole-socket cleanup removes the sid from adapter membership](../src/disconnect.test.ts#L69)
- [a disconnected socket cannot join rooms again](../src/disconnect.test.ts#L83)
- [a reconnected socket does not automatically rejoin its previous rooms](../src/disconnect.test.ts#L103)
- [rooms are still present at disconnecting and empty at disconnect](../src/disconnect.test.ts#L130)
- [a pending client.emitWithAck rejects when the connection drops](../src/disconnect.test.ts#L153)
- [disconnect clears a pending client timeout before rejecting emitWithAck](../src/disconnect.test.ts#L165)
- [a disconnect from an outgoing observer clears the current emitWithAck timeout](../src/disconnect.test.ts#L191)
- [a trailing-callback ack is silently discarded when the connection drops](../src/disconnect.test.ts#L218)
- [a pending server.emitWithAck stays pending when the client disconnects](../src/disconnect.test.ts#L237)
- [client.disconnect() reports io client disconnect to the client and client namespace disconnect to the server](../src/disconnect.test.ts#L263)
- [serverSocket.disconnect() reports io server disconnect to the client and server namespace disconnect to the server](../src/disconnect.test.ts#L279)
- [disconnecting carries the same reason and fires before disconnect](../src/disconnect.test.ts#L295)

### Shared Manager disconnect

Namespace grouping, connection-wide teardown order, independent Managers, and reconnect
cleanup.

- [disconnect(false) closes only its namespace socket](../src/manager-disconnect.test.ts#L26)
- [disconnect(true) is inert after that server socket disconnects with false](../src/manager-disconnect.test.ts#L50)
- [disconnect(true) closes shared namespaces in connection order before returning](../src/manager-disconnect.test.ts#L66)
- [disconnect(true) from a connection handler includes the initiator and isolates opt-outs](../src/manager-disconnect.test.ts#L101)
- [disconnect(true) cancels pending namespace admission on the shared Manager](../src/manager-disconnect.test.ts#L153)
- [reentrant client disconnects do not duplicate shared Manager teardown](../src/manager-disconnect.test.ts#L195)
- [disconnect(true) leaves duplicate and opted-out Managers connected](../src/manager-disconnect.test.ts#L222)
- [shared Manager teardown rejects client acks and permits explicit reconnect](../src/manager-disconnect.test.ts#L248)
- [disconnect(true) from a stale server socket leaves the reconnect connected](../src/manager-disconnect.test.ts#L284)

### Server close

Server-wide teardown, its reasons, and what happens to pending acknowledgements.

- [close invokes its callback and reports when called again](../src/server-close.test.ts#L12)
- [close rejects a connection started immediately before it](../src/server-close.test.ts#L19)
- [close disconnects every namespace with the shutdown reasons](../src/server-close.test.ts#L32)
- [close rejects a pending client emitWithAck](../src/server-close.test.ts#L66)
- [close leaves a pending server emitWithAck pending](../src/server-close.test.ts#L78)
- [close does not cancel an armed server acknowledgement timeout](../src/server-close.test.ts#L102)

### Return values

What emit, listener, middleware, connect, and disconnect methods hand back, and which
chain.

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
- [the server socket listener methods return the socket, so they chain](../src/emitter-returns.test.ts#L106)
- [chained registrations both take effect](../src/emitter-returns.test.ts#L121)
- [a namespace on returns the namespace, so it chains](../src/emitter-returns.test.ts#L136)
- [server and namespace use return the object they register on](../src/emitter-returns.test.ts#L141)
- [client connect returns the socket while connected and when reconnecting](../src/emitter-returns.test.ts#L149)
- [client disconnect returns the socket whether or not it is connected](../src/emitter-returns.test.ts#L159)
- [server socket disconnect returns that socket](../src/emitter-returns.test.ts#L165)

### Inherited emitter compatibility

Node and component-emitter aliases, listener order, wrappers, removal, delegation, and
max-listener state.

- [Server listener methods delegate state and runtime identity to the root Namespace](../src/inherited-emitter.test.ts#L7)
- [Namespace prepend methods order connection listeners and expose once wrappers](../src/inherited-emitter.test.ts#L32)
- [ParentNamespace snapshots inherited listener ordering when each child is created](../src/inherited-emitter.test.ts#L62)
- [server Socket inherited methods preserve Node ordering and raw listener identity](../src/inherited-emitter.test.ts#L100)
- [named listener callbacks receive their Namespace or Socket receiver](../src/inherited-emitter.test.ts#L131)
- [Node emitter aliases remove the last matching registration](../src/inherited-emitter.test.ts#L201)
- [once wrapper identity properties remain specific to each emitter side](../src/inherited-emitter.test.ts#L217)
- [max-listener state is receiver-local and Server delegates it to root](../src/inherited-emitter.test.ts#L236)
- [Node receivers warn once when a listener count exceeds their local maximum](../src/inherited-emitter.test.ts#L259)
- [Namespace removal and filtered counts follow Node EventEmitter](../src/inherited-emitter.test.ts#L312)
- [Node eventNames uses property-key order for integers, strings, and symbols](../src/inherited-emitter.test.ts#L333)
- [Namespace meta-events collide with Socket.IO reserved outgoing names](../src/inherited-emitter.test.ts#L350)
- [Server delegates the newListener collision to the root Namespace](../src/inherited-emitter.test.ts#L367)
- [server Socket meta-events collide before add and after once removal](../src/inherited-emitter.test.ts#L375)
- [client source and declaration aliases share component-emitter identity](../src/inherited-emitter.test.ts#L395)
- [client removeAllListeners with no event clears every ordinary listener](../src/inherited-emitter.test.ts#L424)

## smocket only

These have no oracle to compare against: they cover the API smocket adds
([differences.md
§B](./differences.md#b-what-smocket-adds-that-socketio-has-no-equivalent-for)) and the
internals behind it, so they run the same under both targets. They are listed apart
because nothing about socket.io follows from them.

### connect(url) and the origin registry

Resolving a url to a server, and what the url contributes to the handshake.

- [connect(url) resolves to the server registered for that origin](../src/connect-url.test.ts#L14)
- [a missing-server socket exposes disconnected state and mutable auth](../src/connect-url.test.ts#L25)
- [handshake.url is the normalized origin the client connected to](../src/connect-url.test.ts#L41)
- [two spellings of one origin resolve to the same server](../src/connect-url.test.ts#L53)
- [connect(url) caches one Manager per normalized origin unless opted out](../src/connect-url.test.ts#L63)
- [the url's query string lands on handshake.query](../src/connect-url.test.ts#L89)
- [connect(url, { auth }) puts the auth object on the handshake](../src/connect-url.test.ts#L102)
- [a function auth holds the pairing until its callback fires](../src/connect-url.test.ts#L110)
- [a function auth is re-evaluated on each connection, including a reconnect](../src/connect-url.test.ts#L130)
- [a completed reconnect resets client.recovered to false](../src/connect-url.test.ts#L147)
- [the url query wins wholesale over the options query when both are given](../src/connect-url.test.ts#L163)
- [the options query is used only when the url carries none](../src/connect-url.test.ts#L175)
- [the url's path selects the namespace](../src/connect-url.test.ts#L183)
- [connect(url) rejects an unregistered namespace without creating membership](../src/connect-url.test.ts#L193)
- [a relative url resolves against location.origin](../src/connect-url.test.ts#L221)
- [connect(url) to an unregistered origin fires connect_error, without throwing](../src/connect-url.test.ts#L239)
- [a failed client still rejects reserved names on every emit wrapper](../src/connect-url.test.ts#L259)
- [close unregisters the server so later connect(url) reports a missing server](../src/connect-url.test.ts#L280)
- [closing a replaced server does not unregister its replacement](../src/connect-url.test.ts#L301)
- [the socket from a failed connect still chains](../src/connect-url.test.ts#L313)
- [a failed client carries the complete catch-all listener surface](../src/connect-url.test.ts#L349)
- [a failed client carries component-emitter listener introspection](../src/connect-url.test.ts#L380)

### Binary passthrough guard

Keeping out-of-scope binary-containing packets on the existing in-memory path without an
encoding claim.

- [keeps binary-containing packets on the existing in-memory path](../src/binary-passthrough.test.ts#L5)

### Adapter API

Registering an adapter that changes the routing decision.

- [io.adapter registers a custom adapter that observes the routing decision](../src/adapter.test.ts#L41)
- [a custom adapter can drop a socket from the target set, and per-socket order still holds](../src/adapter.test.ts#L64)
- [registering a custom adapter preserves per-socket delivery order](../src/adapter.test.ts#L92)
- [builds an independent registered adapter for each dynamic concrete child](../src/adapter.test.ts#L116)

### Adapter lifecycle

Factory isolation, setup boundaries, and whole-socket cleanup.

- [builds isolated adapters for root, existing, future static, and dynamic namespaces](../src/adapter-lifecycle.test.ts#L44)
- [keeps every existing adapter unchanged when replacement construction fails](../src/adapter-lifecycle.test.ts#L79)
- [rejects one adapter instance shared by multiple namespaces without partial replacement](../src/adapter-lifecycle.test.ts#L98)
- [reports dynamic adapter construction failure and lets the client retry](../src/adapter-lifecycle.test.ts#L113)
- [does not register a future static namespace when its adapter construction fails](../src/adapter-lifecycle.test.ts#L143)
- [rejects reusing an existing adapter for a future namespace](../src/adapter-lifecycle.test.ts#L157)
- [closes adapter registration at the first connection attempt, including rejection](../src/adapter-lifecycle.test.ts#L170)
- [signals whole-socket removal once for the client teardown path](../src/adapter-lifecycle.test.ts#L182)
- [signals whole-socket removal once for the server teardown path](../src/adapter-lifecycle.test.ts#L182)
- [signals whole-socket removal once for the manager teardown path](../src/adapter-lifecycle.test.ts#L182)
- [signals whole-socket removal once for the close teardown path](../src/adapter-lifecycle.test.ts#L182)
- [signals cleanup once for rejected and cancelled admission without lifecycle events](../src/adapter-lifecycle.test.ts#L219)

### TracingAdapter

Recording immutable final broadcast routing decisions without payloads.

- [records one final decision for Server, Namespace, room, exclusion, and Socket entry points](../src/tracing-adapter.test.ts#L28)
- [keeps root and named namespace history isolated](../src/tracing-adapter.test.ts#L88)
- [records a dynamic parent broadcast once in each concrete namespace](../src/tracing-adapter.test.ts#L108)
- [records empty and volatile final recipient sets plus callback and Promise ack broadcasts](../src/tracing-adapter.test.ts#L127)
- [records before outgoing observation and delivery without changing FIFO](../src/tracing-adapter.test.ts#L154)
- [excludes direct socket traffic and failed broadcast encoding](../src/tracing-adapter.test.ts#L184)
- [returns caller-cleared immutable snapshots with no payload reference](../src/tracing-adapter.test.ts#L203)
- [observes recipients after a wrapped custom adapter changes routing](../src/tracing-adapter.test.ts#L237)
- [composes with DelayingAdapter scheduling and removal](../src/tracing-adapter.test.ts#L266)

### Deterministic broadcast dropping

A Smocket-only final-recipient filter by sid, including acknowledgements, cleanup,
namespace isolation, and adapter composition.

- [drops io.emit by sid and restores delivery without changing membership](../src/dropping-adapter.test.ts#L28)
- [preserves room union, exclusions, sender exclusion, and unaffected direct traffic](../src/dropping-adapter.test.ts#L57)
- [removes dropped recipients from callback and Promise acknowledgement collection](../src/dropping-adapter.test.ts#L106)
- [does not cancel a broadcast acknowledgement already selected before the drop](../src/dropping-adapter.test.ts#L123)
- [skips outgoing observation for dropped delivery and preserves remaining FIFO](../src/dropping-adapter.test.ts#L146)
- [cleans state on disconnect, gives reconnect a fresh sid, and isolates namespaces](../src/dropping-adapter.test.ts#L173)
- [composes dropping before tracing with wrapped delayed FIFO delivery](../src/dropping-adapter.test.ts#L204)
- [receives the ordered final ids after volatile filtering and cannot add or reorder](../src/dropping-adapter.test.ts#L233)

### Broadcast management adapter boundary

Keeping local management selection on canonical Socket state instead of custom event
routing and delivery filtering.

- [management lookup ignores custom routing and delivery dropping](../src/broadcast-management-adapter.test.ts#L10)
- [bulk membership ignores custom routing and delivery dropping](../src/broadcast-management-adapter.test.ts#L28)

### DelayingAdapter

Holding a socket's client-inbound stream so a race can be interleaved on purpose.

- [an emit from a connection handler reaches the client, before the pairing completes](../src/delay-adapter.test.ts#L28)
- [a delayed socket is held on the timer while an undelayed one still arrives next tick](../src/delay-adapter.test.ts#L41)
- [does not delay the server side: a client emit is received on the next tick](../src/delay-adapter.test.ts#L64)
- [preserves order within a delayed socket's stream, and holds it until the delay elapses](../src/delay-adapter.test.ts#L80)
- [a lowered delay does not let a new event overtake one already queued](../src/delay-adapter.test.ts#L100)
- [a new delay applies only to deliveries scheduled after it is set](../src/delay-adapter.test.ts#L121)
- [gates order through the queue, not the timer: only the head is ever scheduled](../src/delay-adapter.test.ts#L142)
- [ignores a non-finite delay rather than storing NaN or Infinity](../src/delay-adapter.test.ts#L178)
- [keeps delay state when the socket leaves only its id room](../src/delay-adapter.test.ts#L194)
- [drains a queued stream during close without duplicating scheduled callbacks](../src/delay-adapter.test.ts#L212)
- [drains the remaining queue when the scheduled head triggers teardown](../src/delay-adapter.test.ts#L260)
- [does not carry an old sid delay into a reconnect](../src/delay-adapter.test.ts#L281)

### Native broadcast Promise policy

Applying Smocket-only pre-connect volatile selection before acknowledgement counting.

- [volatile Promise collection excludes pre-connect recipients from its expected count](../src/broadcast-promise-ack-native.test.ts#L5)

### Socket id encoding

The encoder behind the id shape the dual run pins.

- [encodes bytes the way base64url does, url-safe alphabet included](../src/socket-id.test.ts#L13)
- [strips the padding a length off a multiple of three produces](../src/socket-id.test.ts#L23)
- [an id is 15 random bytes run through that encoder](../src/socket-id.test.ts#L31)

### Public entry points

What the package exports, including the `io` name the substitution path needs.

- [connecting pairs the client and server socket with the same id](../src/index.test.ts#L31)
- [exports `io` as socket.io-client's name for connect, so a module swap works](../src/index.test.ts#L41)
- [exports the contract types, so the swap keeps an app annotations to use](../src/index.test.ts#L53)
- [exports a server type that keeps the smocket-only members](../src/index.test.ts#L105)
- [exports the tracing adapter and trace type](../src/index.test.ts#L130)
- [exports the deterministic dropping adapter](../src/index.test.ts#L146)

### Public direct connection API

Pairing direct clients with server sockets, namespace queue order, admission outcomes,
and close settlement.

- [connect and nextConnection expose both sides of one admitted socket](../src/connection-api.test.ts#L18)
- [pairs wait-before-connect and connect-before-wait in connection order](../src/connection-api.test.ts#L38)
- [pairs connect-before-wait on a registered named namespace](../src/connection-api.test.ts#L51)
- [pairs multiple waiting observers with clients in FIFO order](../src/connection-api.test.ts#L63)
- [returns multiple ready sockets in FIFO order](../src/connection-api.test.ts#L73)
- [normalizes namespace names while keeping their queues isolated](../src/connection-api.test.ts#L87)
- [keeps direct connections in the established Manager groups](../src/connection-api.test.ts#L103)
- [skips rejected admission and resolves the waiter with the next accepted socket](../src/connection-api.test.ts#L120)
- [skips cancelled admission and resolves the waiter with the next accepted socket](../src/connection-api.test.ts#L138)
- [close rejects pending static and dynamic namespace observers](../src/connection-api.test.ts#L164)
- [close discards unclaimed sockets and rejects later observers](../src/connection-api.test.ts#L183)
- [close preserves a ready socket claimed before teardown](../src/connection-api.test.ts#L193)

<!-- conformance:generated end -->

## Not covered yet

Socket.IO surface in smocket's lane that no case above compares. Absence here means it
has not been measured, not that it is missing from socket.io.

- **Remaining broadcast management method.** `disconnectSockets` acts on the canonical
  set a broadcast operator selects. Deprecated
  `allSockets` is deliberately deferred by
  [0037](./decisions/0037-keep-broadcast-management-local-and-canonical.md).
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
