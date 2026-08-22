# 0038. SharedWorker is an explicit, narrow facade

**Status:** Accepted — 2026-08-23 — #376, #377, #379
**Governed by:** [0000](./0000-do-not-invent-what-has-no-source.md),
[0010](./0010-single-defer-primitive-and-fifo.md),
[0012](./0012-reject-inflight-acks-on-disconnect.md),
[0020](./0020-close-follows-socket-lifecycle.md),
[0023](./0023-client-package-is-a-thin-facade.md),
[0026](./0026-payloads-cross-a-json-snapshot-boundary.md),
[0031](./0031-adapter-registration-and-removal-lifecycle.md)

> **TL;DR** Callers create and version a module `SharedWorker`, run their Smocket
> server handlers inside it, and connect through explicit worker subpaths. The page
> receives a narrow socket facade, not the complete Socket.IO Client contract.

## Decision

Real Socket.IO clients share rooms and server state by reaching one external server.
SharedWorker Smocket reproduces that development scene by moving one existing Smocket
server and its real client sockets into a worker. It is not a transport, reconnection,
authentication, persistence, or production-server substitute.

The caller owns `new SharedWorker(url, { name, type: 'module' })`. Its worker entry creates
`Server`, registers application handlers, then attaches the port host exported from
`smocket/shared-worker`. The caller supplies a `new URL(..., import.meta.url)` script URL
and a stable name containing its application worker version. Handlers must be worker-safe:
no DOM, `window`, `localStorage`, or Node-only API is available.

Pages import `connectSharedWorker` from `smocket-client/shared-worker` and pass one port,
the server URL, and a serializable auth object. This explicit bootstrap is required;
aliasing `socket.io-client` alone cannot move state across realms. Application handlers
and supported socket calls may be shared by dependency injection. A real deployment
replaces this bootstrap with Socket.IO Client and removes the worker entry and alias.

`SharedWorkerSocket` is independent of `ClientSocketContract`. It exposes `id`,
`connected`, `disconnected`, and mutable object `auth`; `on`, `once`, `off`, `listeners`,
`removeAllListeners`, `onAny`, `offAny`, and `listenersAny`; `emit`, `send`, and
`emitWithAck`; and `connect`/`open` plus `disconnect`/`close`. It includes `connect`,
`connect_error`, `disconnect`, and `bridge_error` lifecycle events. It does not expose
`io`, `recovered`, auth callbacks, acknowledgement `timeout`, `volatile`, `compress`,
outgoing catch-alls, prepend variants, or unchecked aliases to the complete client type.

Each facade owns one active connection generation on one port. `connect()` snapshots the
current auth object and replaces any earlier generation; there is no automatic retry.
The bridge validates a versioned message union at both ends. Malformed, unexpected, and
version-mismatched messages become `bridge_error` without escaping the worker event loop.

Functions never cross the structured-clone boundary. Callback acknowledgements and
`emitWithAck` use direction-specific ids, settle at most once, and are removed when their
generation ends. The initial facade has no acknowledgement timeout. An unacknowledged
callback or promise remains unsettled, while disconnect prevents a later bridge response
from invoking it.

FIFO is guaranteed for messages on one port and for delivery to one socket under 0010.
Messages from different ports are handled in the order the worker receives them; the API
does not claim a global order across tabs. Payloads retain the 0026 JSON snapshot boundary
before they cross the additional structured-clone boundary.

Explicit disconnect is authoritative. `pagehide` sends a best-effort disconnect for a
normal close, reload, or navigation. The tested Chromium page-close path cleans up, but an
abrupt process crash is not promised to be immediate. No heartbeat is added. Worker
termination or restart loses every in-memory socket, room, and pending acknowledgement;
the page must reload or explicitly create a fresh worker and socket.

Protocol version and application worker version are separate. HMR changes the worker URL
or name so new pages cannot join an incompatible surviving worker; old pages may retain
the old worker until they close. State is neither migrated nor shared between versions.

The supported automated target begins with desktop Chromium and requires `SharedWorker`
feature detection. Other engines are unverified until they run the same lifecycle suite.
Sharing is limited to the same origin, browser profile, worker script URL, and name. The
built-in adapter and worker-safe local custom adapters are allowed; Redis, remote sockets,
and multi-server coordination remain outside scope.

## Alternatives rejected

- **Cast the facade to `ClientSocketContract`.** Missing manager, modifier, auth-callback,
  and reconnection behavior would turn a convenient type into a false compatibility claim.
- **Make an alias sufficient.** A package alias cannot create, name, or initialize the
  caller-owned worker or register server handlers in its realm.
- **Create the worker implicitly.** Hidden URL, name, CSP, and HMR choices would prevent
  deterministic ownership and make multiple application workers ambiguous.
- **Promise immediate crash cleanup.** The browser does not provide a reliable port-close
  signal for every termination, and reproducing heartbeat is outside Smocket's scope.
