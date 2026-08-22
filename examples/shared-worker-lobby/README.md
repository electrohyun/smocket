# SharedWorker lobby example

> **TL;DR** This static Vite app runs caller-written lobby handlers in one
> SharedWorker and connects three same-origin tabs through Smocket's explicit
> worker bridge. It demonstrates multi-tab delivery without starting a Node
> Socket.IO server.

## Run it by hand

From the repository root:

```bash
pnpm --filter shared-worker-lobby-example dev
```

Open three tabs at the printed origin:

- `/?label=A`
- `/?label=B`
- `/?label=C`

Select **Ready** in all three tabs, then select **Start game** in leader tab A.
All tabs receive the same lobby state and start event. Closing C removes it from
the two remaining views.

Run the same workflow headlessly with:

```bash
pnpm example:shared-worker
```

## Source map

- [`src/application.ts`](./src/application.ts) owns event types and the
  Socket.IO-shaped lobby handlers.
- [`src/worker.ts`](./src/worker.ts) creates `Server` and attaches each incoming
  SharedWorker port through `smocket/shared-worker`.
- [`src/client.ts`](./src/client.ts) creates the caller-owned worker and obtains a
  narrow socket facade from `smocket-client/shared-worker`.
- [`verify.mjs`](./verify.mjs) opens A, B, and C in Chromium and checks distinct
  sockets, shared readiness, leader start, and page-close cleanup.

The example intentionally contains no real transport or backend. See the
[multi-tab workflow guide](../../docs/shared-worker.md) for worker ownership,
production migration, browser boundaries, HMR, CSP, and lifecycle limits.
