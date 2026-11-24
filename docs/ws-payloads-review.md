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
The [receive validation review](./ws-receive-validation-review.md) covers malformed
UTF-8 rejection. Caller-buffer mutation requires separate comparisons in
[#540](https://github.com/electrohyun/smocket/issues/540).
The [close-race review](./ws-close-races-review.md) covers accepted sends during
termination and messages received while normal closing is pending.

Client membership comparisons live in the [client set review](./ws-client-tracking-review.md).
Production entry-point binding and independent package consumers belong to
[#562](https://github.com/electrohyun/smocket/issues/562).
