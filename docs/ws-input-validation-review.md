# ws input validation review notes

> **TL;DR** URL validation and close argument checks follow real ws within the
> selected application contract. Validation order includes synchronous exceptions
> and the socket state visible immediately after a call.

## Implementation choices

Real ws [normalizes URLs and checks socket state before closing](https://github.com/websockets/ws/blob/8.21.3/lib/websocket.js).
[`runtime.ts`](../src/ws/runtime.ts) accepts strings and URL objects, converts
http/https to ws/wss, and rejects malformed URLs and nonempty fragments synchronously.
An empty fragment remains allowed. A caller-supplied URL receives the same protocol
conversion, but subsequent caller mutations cannot change the pending connection.
The runtime snapshots its normalized href before scheduling the connection.

Unsupported-protocol exceptions retain ws's original message, including its
ws+unix entry. That wording does not add IPC support to the selected contract in
[0044](./decisions/0044-ws-api-without-transport.md). Secure URL parsing does not
provide TLS servers or establish successful secure connections.

Real ws [checks close arguments in its sender](https://github.com/websockets/ws/blob/8.21.3/lib/sender.js)
after changing an open socket to CLOSING. Invalid codes therefore throw TypeError
without restoring OPEN. Code validation precedes the reason's 123-byte limit;
oversized reasons throw RangeError. Strings use UTF-8 byte length. Buffer reasons
are copied before asynchronous delivery, so later caller writes cannot change them.

Omitting the code ignores the reason. CONNECTING aborts before checking arguments;
CLOSING and CLOSED ignore them. ws's [status-code predicate](https://github.com/websockets/ws/blob/8.21.3/lib/validation.js)
accepts fractional numbers within its ranges; encoding truncates accepted values.
The in-memory runtime applies that observable conversion without writing a frame.

## Validation limits

[`input-validation.test.ts`](../test/ws/input-validation.test.ts) compares the same
calls against real ws and the mock, including both closing sides, reserved codes,
range limits, UTF-8 reason boundaries, reason copies, URL snapshots, and immediate
state changes. URL-only secure cases abort immediately and do not verify TLS success.

Buffer reason comparisons use valid UTF-8. Receiver rejection of malformed UTF-8
or fractional codes that truncate to reserved values, full failure ordering,
pending work, and concurrent close remain the comparisons in
[#540](https://github.com/electrohyun/smocket/issues/540).
The public package binding remains [#562](https://github.com/electrohyun/smocket/issues/562).
