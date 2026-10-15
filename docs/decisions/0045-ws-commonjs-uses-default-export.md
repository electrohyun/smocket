# 0045. Use the default export for ws CommonJS consumers

**Status:** Accepted · 2026-10-12 · #562
**Supersedes:** The CommonJS export shape in [0044](./0044-ws-api-without-transport.md)

> **TL;DR** CommonJS uses require('smocket/ws').default for the WebSocket constructor.
> ESM keeps the default import, and both loaders expose named WebSocket and
> WebSocketServer exports. This is an intentional packaging difference from ws.

## Decision

Use these constructor imports:

```js
import WebSocket, { WebSocketServer } from 'smocket/ws';
```

```js
const WebSocket = require('smocket/ws').default;
const { WebSocketServer } = require('smocket/ws');
```

Real ws returns its constructor directly from require(). Smocket instead uses the
module object produced by its existing ESM/CJS build. The WebSocketModule contract
describes that object separately from its constructible default export. The named
WebSocket export and the default export refer to the same constructor.

This keeps both formats on the standard build and declaration path without a custom
CommonJS wrapper. Independent package consumers must verify both loading forms and
generated types; source contract checks alone cannot prove the packaged result.
The remaining application contract and exclusions in 0044 stay accepted.

## Alternatives rejected

- **Return the constructor directly from require().** This requires a separate
  CommonJS wrapper and matching declarations for a second export shape.
- **Drop CommonJS support.** The existing package supports both loaders; the
  explicit default lookup keeps that support without the wrapper.
