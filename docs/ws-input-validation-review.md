# ws input validation review notes

> **TL;DR** URL validation and close argument checks follow real ws within the
> selected application contract. Validation order includes synchronous exceptions
> and the socket state visible immediately after a call.

## Implementation choices

Real ws [normalizes URLs and checks socket state before closing](https://github.com/websockets/ws/blob/8.23.0/lib/websocket.js).
[`runtime.ts`](../src/ws/runtime.ts) accepts strings and URL objects, converts
http/https to ws/wss, and rejects malformed URLs and nonempty fragments synchronously.
An empty fragment remains allowed. The runtime normalizes a private copy of a
caller-supplied URL, leaving the original object unchanged. Subsequent caller
mutations cannot change the pending connection or the client's normalized URL.

Unsupported-protocol exceptions retain ws's original message, including its
ws+unix entry. That wording does not add IPC support to the selected contract in
[0044](./decisions/0044-ws-api-without-transport.md). Secure URL parsing does not
provide TLS servers or establish successful secure connections.

Real ws [checks close arguments in its sender](https://github.com/websockets/ws/blob/8.23.0/lib/sender.js)
before changing an open socket to CLOSING. Invalid codes therefore throw TypeError
while leaving the socket OPEN, and a later valid close can complete normally.
Code validation precedes the reason's 123-byte limit; oversized reasons throw
RangeError and also leave the socket OPEN. Strings use UTF-8 byte length. Buffer
reasons are copied before asynchronous delivery, so later caller writes cannot
change them.

Omitting the code ignores the reason. CONNECTING aborts before checking arguments;
CLOSING and CLOSED ignore them. ws's [status-code predicate](https://github.com/websockets/ws/blob/8.23.0/lib/validation.js)
accepts fractional numbers within its ranges; encoding truncates accepted values.
The in-memory runtime applies that observable conversion without writing a frame.

## Validation limits

[`input-validation.test.ts`](../test/ws/input-validation.test.ts) compares the same
calls against real ws and the mock, including both closing sides, reserved codes,
range limits, UTF-8 reason boundaries, reason copies, URL preservation and snapshots,
immediate state changes, and successful close after rejected arguments. URL-only
secure cases abort immediately and do not verify TLS success.

The [receive validation review](./ws-receive-validation-review.md) covers malformed
UTF-8 and fractional codes that truncate to reserved values. The
[close-race review](./ws-close-races-review.md) covers pending work and concurrent close.
The public package binding remains [#562](https://github.com/electrohyun/smocket/issues/562).
