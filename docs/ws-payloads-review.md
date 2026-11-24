# ws payload and callback review notes

> **TL;DR** Selected ws inputs become message bytes, binary options control message
> kind, and binaryType controls received binary data. Send callbacks confirm local
> completion independently of peer receipt.

## Implementation choices

Real ws [normalizes numbers and selects binary defaults before sending](https://github.com/websockets/ws/blob/8.23.0/lib/websocket.js).
[`data.ts`](../src/ws/data.ts) preserves raw byte-view offsets and lengths and uses
Buffer.from for other inputs, including foreign-realm buffers and
valueOf/Symbol.toPrimitive fallback. It copies the converted bytes.
Message delivery uses bytes without encoding frames.
Text still reaches ordinary message listeners as Buffer with isBinary=false.
Binary messages use the receiver's nodebuffer or arraybuffer setting.

Successful ws callbacks receive null despite its optional-Error declaration. The
runtime preserves that type and uses Reflect.apply for the null success argument.
Changing it to undefined would differ from observed ws behavior. CLOSING/CLOSED
sends report an asynchronous Error; CONNECTING sends throw synchronously.
CONNECTING rejects before converting the input. Other states still convert selected
inputs before reporting a state error, so a throwing valueOf throws synchronously
without scheduling a callback even after close.

## Validation limits

[`payloads.test.ts`](../test/ws/payloads.test.ts) compares selected inputs, binary
overrides, receive representation, callbacks, and state-dependent send errors on both
socket sides. A later message marks mixed text/byte FIFO ordering; closing immediately
after several sends preserves their messages before the close event and completes
each callback once. These checks do not require callback order relative to peer receipt.
[`buffer-lifetime.test.ts`](../test/ws/buffer-lifetime.test.ts) changes caller-owned
storage immediately after send and from its successful callback. Small Buffer,
offset Uint8Array/DataView, ArrayBuffer, and SharedArrayBuffer inputs retain their
original received bytes in both directions. Consecutive sends reusing one Buffer
also retain distinct message bytes. A later marker completes the receive sequence;
normal close ends the callback sequence. These comparisons establish copied delivery
bytes for the selected inputs, not large queued writes or transport backpressure.

The [receive validation review](./ws-receive-validation-review.md) covers malformed
UTF-8 rejection.
The [close-race review](./ws-close-races-review.md) covers accepted sends during
termination and messages received while normal closing is pending.

Client membership comparisons live in the [client set review](./ws-client-tracking-review.md).
Production entry-point binding and independent package consumers are described in
the [package review](./ws-package-review.md).
