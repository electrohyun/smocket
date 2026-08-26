# smocket-client

> The client-facing companion to `smocket`. It preserves the supported
> Socket.IO Client import shape while sharing the in-process server registry
> with an exact-version `smocket` peer loaded through the same module format.

## Install

```sh
npm install -D smocket smocket-client
```

Keep both packages at the same exact version. `smocket` provides the server and
`smocket-client` provides the client connection facade.

The published declarations support TypeScript 5.0.2 and newer under NodeNext and
Bundler module resolution.

## Use

```ts
import { Server } from 'smocket';
import { connect } from 'smocket-client';

const io = new Server('http://localhost:3000');
const client = connect('http://localhost:3000');
```

The default export, `io`, and `connect` are the same lookup function. The package
also exports the supported client-side `Socket` and option types.

Applications can keep importing `socket.io-client` when their test runner maps
that package name to `smocket-client`. See the
[test-runner integration guide](https://github.com/electrohyun/smocket/blob/main/docs/test-runner-integration.md)
for Vitest and Jest examples.

## SharedWorker tabs

Browser pages can explicitly import `connectSharedWorker` from
`smocket-client/shared-worker` and pass a port from a caller-owned module
`SharedWorker`. The worker imports `attachSharedWorker` from
`smocket/shared-worker`, creates the server, and registers application handlers.
This facade is intentionally narrower than the ordinary client contract; see the
[multi-tab workflow guide](https://github.com/electrohyun/smocket/blob/main/docs/shared-worker.md)
for the runnable example, supported surface, production migration, and browser
limits.

Smocket models Socket.IO's in-process logic layer. It does not reproduce
transports, heartbeat, reconnection, or multi-server adapters. See the
[documented scope](https://github.com/electrohyun/smocket/blob/main/docs/scope.md)
and [supported differences](https://github.com/electrohyun/smocket/blob/main/docs/differences.md).

Licensed under the [MIT License](LICENSE).
