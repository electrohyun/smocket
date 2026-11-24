# Shared listener bookkeeping

> **TL;DR** Socket.IO and ws use one internal listener module. It owns registration,
> removal, listener inspection, and once-wrapper identity without depending on
> either protocol's contracts or delivery rules.

[`core/listeners.ts`](../src/core/listeners.ts) contains the Node-style emitter base
and reusable listener helpers. Socket.IO namespaces, server sockets, and the ws
emitter import it directly. Its only module dependency is the existing
[host EventEmitter probe](../src/host-emitter.ts), which handles the host's final
removeListener notification behavior without a static Node import.

Socket.IO catch-all dispatch, reserved events, and scheduling remain in
[`runtime/emitters.ts`](../src/runtime/emitters.ts). The
[ws adapter](../src/ws/emitter.ts) retains its registration aliases, explicit
undefined removal behavior, and typed event callbacks. Neither protocol delegates
its message routing, acknowledgements, connection states, or close behavior to this
listener module.

This extraction moves existing bookkeeping rather than introducing a new public
API. The existing listener comparisons exercise both protocols, including the
Socket.IO browser path. Delivery queues remain local to their implementations.
