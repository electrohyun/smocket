# Multi-tab frontend development with SharedWorker

> **TL;DR** A caller-owned module `SharedWorker` can host one Smocket server for
> same-origin tabs during frontend development. Use the explicit worker subpaths,
> keep application handlers worker-safe, and switch the page bootstrap to a real
> Socket.IO client and server for transport, authentication, and deployment checks.

## Run the example

```bash
pnpm --filter shared-worker-lobby-example dev
```

Open `?label=A`, `?label=B`, and `?label=C` at the printed URL. The tabs join one
lobby, become ready, start from the leader tab, and observe a departure together.
`pnpm example:shared-worker` runs that workflow automatically in Chromium.

The example is a static Vite frontend. It does not start Node or a Socket.IO
server. [`worker.ts`](../examples/shared-worker-lobby/src/worker.ts) creates the
Smocket server and registers the caller's handlers, while
[`client.ts`](../examples/shared-worker-lobby/src/client.ts) creates the browser
worker and connects its port. The application event and handler contract stays in
[`application.ts`](../examples/shared-worker-lobby/src/application.ts).

For a complete React game with drawing, guesses, a countdown, page-close cleanup,
and a matching Real Socket.IO mode, run `pnpm example:drawing-game` and follow the
[multi-tab drawing game](../examples/drawing-game/README.md). Its worker and real
server register the same application handler.

## Own the worker boundary

The worker imports `Server` from `smocket` and `attachSharedWorker` from
`smocket/shared-worker`. Each page imports `connectSharedWorker` from
`smocket-client/shared-worker`. The returned facade supports the event listener,
emit, acknowledgement, connection, and lifecycle surface listed in
[ADR 0038](./decisions/0038-shared-worker-is-an-explicit-narrow-facade.md); it is
not the complete Socket.IO Client API.

> [!IMPORTANT]
> Create the worker with a bundled `new URL('./worker.ts', import.meta.url)`, module
> type, and a stable application-versioned name. Tabs share state only when origin,
> browser profile, script URL, and worker name all match. A different browser,
> device, profile, origin, URL, or name gets independent state.

Worker handlers cannot use the DOM, `window`, `localStorage`, or Node-only APIs.
Payloads and auth must cross the structured-clone boundary. Feature-detect
`SharedWorker` and show an actionable fallback. A restrictive CSP must permit the
bundler's worker output, commonly with `worker-src 'self'` for same-origin assets.

## Move to real Socket.IO

Keep the event names, payload types, and transport-neutral handler logic. In the
deployed page, create a `socket.io-client` connection instead of the SharedWorker
facade. Run the handlers behind a real Socket.IO server and omit the worker entry
from the production bootstrap.

That real-server path is required to verify network transport, reconnection,
authentication, database access, persistence, and cross-device behavior. Smocket
inside a worker verifies in-memory delivery and routing only.

## Normal shutdown

Call the facade's `socket.disconnect()` (or its `socket.close()` alias) while the
`MessagePort` is still usable. That request owns normal teardown of the active
generation, including its server socket and room membership. Do not close the raw
port first or use `worker.port.close()` as a substitute for facade disconnect.

Worker code that deliberately detaches an accepted port should retain the
`SharedWorkerHost` returned by `attachSharedWorker` and call `host.close()`. That
disconnects the port's active server socket and removes the host listeners; it does
not close the `MessagePort` or the caller-owned `Server`.

## Lifecycle limits

> [!WARNING]
> `pagehide` sends a best-effort facade disconnect, and the Chromium page-close workflow
> is tested. A raw port close, abrupt renderer or worker crash, forced browser
> termination, and OS process loss do not provide the same cleanup guarantee because no
> heartbeat or reliable port-close signal is invented. Worker termination or restart
> loses sockets, rooms, state, and pending acknowledgements.

The maintained Chromium workflow also covers same-origin navigation into the
[back-forward cache](https://developer.chrome.com/docs/web-platform/bfcache-notrestoredreasons/).
Both `pagehide.persisted` and the restored `pageshow.persisted` are true, and the same
page JavaScript instance returns. The facade is nevertheless disconnected because the
`pagehide` handler already requested teardown; it does not reconnect on `pageshow`.

After a BFCache restoration, call `socket.connect()` (or `socket.open()`) explicitly,
then repeat application admission such as joining rooms. That creates a fresh socket id
and connection generation. Automatic retry remains outside the facade under
[ADR 0038](./decisions/0038-shared-worker-is-an-explicit-narrow-facade.md).

During HMR, version the worker URL or name so new pages do not join an incompatible
worker that survived the update. Existing pages can retain the old worker until
they close; state is not migrated between versions.
