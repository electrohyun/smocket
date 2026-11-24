# ws connection failure and server close

> **TL;DR** Failed or cancelled connections emit error while CLOSING and then close
> while CLOSED. Stopped-server callbacks run during the next close event, after
> previously registered close listeners, with one error callback per call.

## Connection attempts

Real ws [aborts an incomplete handshake](https://github.com/websockets/ws/blob/8.23.0/lib/websocket.js)
when close or terminate is called while CONNECTING. The internal runtime changes
state before its deferred connection lookup, so that attempt cannot be admitted.
The error precedes close, with code 1006 and an empty Buffer reason.

[`failure.test.ts`](../test/ws/failure.test.ts) compares cancellation, a missing
server, a mismatched host or path, and a secure target against a plain server.
A later matching connection marks the end of each failed attempt and proves that
it produced no server admission. A missing server's address can be reused.
Failure Error values describe the application outcome; native TCP/TLS diagnostics
belong to the host network stack.

## Server close callbacks

Real ws [registers close callbacks as listeners](https://github.com/websockets/ws/blob/8.23.0/lib/websocket-server.js).
When the server has already stopped, each close call registers a one-time wrapper
that supplies the not-running error and schedules another close event. Previously
registered listeners run first. Multiple calls made before that event complete
their callbacks during the first event; each scheduled event still occurs.

The shared comparisons check the event order, asynchronous notification, and
callback arguments. Established connections and normal server shutdown are also
compared by the [basic](../test/ws/basic.test.ts) and
[client-membership](../test/ws/client-tracking.test.ts) suites.
