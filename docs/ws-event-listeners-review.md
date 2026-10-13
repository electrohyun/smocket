# ws event listener review notes

> **TL;DR** ws event properties and add/removeEventListener wrap EventEmitter
> listeners. The adapter reproduces their event values, callback receivers,
> registration identity, and removal behavior without using a browser EventTarget.

## Implementation choices

Real ws implements its own [event objects and listener wrappers](https://github.com/websockets/ws/blob/8.21.3/lib/event-target.js).
[`event-target.ts`](../src/ws/event-target.ts) follows that arrangement. Each callback
receives a fresh event object with the socket as target. Text events contain strings;
ordinary message listeners still receive bytes and isBinary. Binary event mapping
preserves the supplied data reference.

Function handlers receive the socket as this; handleEvent methods receive their
own listener object. Re-registering the same listener ignores later once options.
An event property and addEventListener registration remain independent even when
they use the same function. Replacing a property moves its wrapper to the end of
the listener order, as ws does; null or a non-function clears the property.

WeakMap metadata associates handlers with live emitter wrappers. Lookup through
listeners() also sees through once wrappers, so EventEmitter removal changes the
property getter and permits re-registration. No separate strong handler registry
keeps removed callbacks alive.

[`events.ts`](../src/ws/events.ts) owns read-only event fields and enumerable
prototype getters. These objects do not depend on native DOM Event classes.
Normal completion marks close events clean; failure or abrupt completion does not.

## Validation limits

[`event-target.test.ts`](../test/ws/event-target.test.ts) runs on real ws and the
mock, covering client and accepted sockets, live open/text/close events, and
registration/removal through both APIs. The event wrappers' binary-data check uses
emit() directly; it does not establish support for sending byte payloads.
[`event-target.typecheck.ts`](../test/ws/event-target.typecheck.ts) checks actual
runtime callback receivers, event data, read-only fields, and excluded options.

Full failure ordering, pending work, byte input conversion, and close races remain
the comparisons in [#540](https://github.com/electrohyun/smocket/issues/540).
The package binding and independent consumer checks remain [#562](https://github.com/electrohyun/smocket/issues/562).
