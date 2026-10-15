# ws client set review notes

> **TL;DR** server.clients tracks accepted ws sockets when tracking is enabled.
> Membership and an all-client text broadcast are compared with real ws separately
> from payload handling and package entry checks.

## Implementation choices

Real ws [adds and removes accepted sockets through its clients set](https://github.com/websockets/ws/blob/8.21.3/lib/websocket-server.js).
The runtime creates that public set when clientTracking is omitted or true.
False and explicit undefined leave the property absent, following ws's option spread
and truthiness check. Its close listener removes sockets before user close listeners.

A private socket set remains responsible for internal teardown. Disabling public
tracking does not discard the runtime's ownership of established connections.

## Validation limits

[`client-tracking.test.ts`](../test/ws/client-tracking.test.ts) checks membership,
tracking options, close-listener presence, removal after close, and iteration for an
all-client broadcast. It does not establish sender-exclusion ordering, marker proofs,
packed multi-client consumers, or the application example required by
[#539](https://github.com/electrohyun/smocket/issues/539).
Payload semantics and complete failure ordering belong to
[#540](https://github.com/electrohyun/smocket/issues/540); package entry checks belong to
[#562](https://github.com/electrohyun/smocket/issues/562).
