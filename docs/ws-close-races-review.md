# ws close outcomes and pending delivery

> **TL;DR** Each socket reports the close information it received from its peer.
> Termination stops further incoming delivery, while sends already accepted locally
> still complete their callbacks independently of peer receipt.

## Closing information

Real ws [records received close information separately](https://github.com/websockets/ws/blob/8.23.0/lib/websocket.js)
from its own close request. The internal runtime keeps sent and received information
on each socket and completes normal closing after notifying the peer and scheduling
its response. Simultaneous close calls therefore preserve the opposite side's code
and reason, regardless of which call happened first.

A terminated socket stops accepting incoming notifications. Its peer can still
receive a close already sent before termination. The terminal code, reason, and
wasClean value reflect the close information received by each side, so the two
sockets can finish differently. Completion removes their pairing and close state.

## Pending work

[`close-races.test.ts`](../test/ws/close-races.test.ts) compares both socket sides,
simultaneous closes, same-side and opposite-side termination, and accepted sends.
A receiver that terminates discards pending incoming messages; a sender that
terminates can still deliver a previously accepted send. The callback can succeed
in either case. Each socket's terminal close event ends its incoming sequence.

A still-open peer's accepted message can reach a normally closing socket before
its close event. A message handler can terminate that initiator; real ws may also
process a close already buffered by its receiver. The comparison allows the
corresponding normal or abnormal initiator result while requiring one terminal
event, the peer's received information, and callback completion. It does not pin
the scheduling phase of unrelated Node I/O.

The suite also checks server shutdown before a queued connection is admitted and
uses a later connection at the same address to verify cleanup and reuse.
