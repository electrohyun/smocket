# ws receive errors and close information

> **TL;DR** Invalid text, close codes, and close reasons fail at the receiver.
> The receiver stops incoming delivery and emits an error before closing; its peer
> can receive the protocol error code even though the receiver closes abnormally.

## Receiver checks

Real ws [validates text and close information in its receiver](https://github.com/websockets/ws/blob/8.23.0/lib/receiver.js).
The in-memory runtime validates delivered bytes with Node's isUtf8 without encoding
or parsing a frame. Binary messages preserve the same bytes without text validation.

Invalid text and close reasons emit Error with code WS_ERR_INVALID_UTF8 and initiate
a 1007 close. Invalid received close codes emit RangeError with code
WS_ERR_INVALID_CLOSE_CODE and initiate a 1002 close. Code validation precedes reason
validation. The error-event object's error property retains the emitted Error identity.

The sender accepts some fractional close arguments that become reserved integers
after truncation. The receiver rejects those integers, including an explicitly sent 1005. A close with no supplied code carries no code or reason and remains valid.
Keeping those two cases distinct avoids treating every 1005 as an empty close.

## Closing after an error

Real ws [stops receiving data after a receiver error](https://github.com/websockets/ws/blob/8.23.0/lib/websocket.js).
The runtime likewise stops incoming messages and close acknowledgements. It still
notifies the peer of its outgoing close. The peer can therefore report a clean
1007 or 1002 close while the failing receiver reports an unclean 1006 close.
If a close was already sent, a later receive error keeps that original close.

[`receive-validation.test.ts`](../test/ws/receive-validation.test.ts) compares these
outcomes in both directions, including repeated invalid input and later messages.
The receiver's terminal close event ends its incoming sequence; successful send
callbacks only confirm local completion. The tests also check client-set cleanup.

These checks cover selected application-visible byte and close validation. They do
not establish frame parsing, masking, fragmentation, or transport error equivalence.
