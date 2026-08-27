# Package entry points

> **TL;DR** `smocket` owns the in-process server, `smocket-client` is the
> `socket.io-client` substitution, and their `/shared-worker` subpaths expose the
> explicit worker-host and page-client bridge. Keep both packages on one exact version.

## Choose the import by owner

| Import                         | Owner and role                                                                                                                                               | Main exports                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `smocket`                      | Test or application fixture in the process that owns the mock server.                                                                                        | `Server`, adapters, server contracts, and retained `connect` / `io` client aliases. |
| `smocket/shared-worker`        | SharedWorker bridge code. A worker normally attaches a caller-owned port to its `Server`; lower-level bridge tests may also create the page facade directly. | `attachSharedWorker`, `connectSharedWorker`, and bridge types.                      |
| `smocket-client`               | Application-facing replacement for `socket.io-client` in an in-process test.                                                                                 | default lookup, `io`, `connect`, client `Socket`, and supported options.            |
| `smocket-client/shared-worker` | Browser page code connecting through a caller-created `SharedWorker` port.                                                                                   | `connectSharedWorker` and page-socket types.                                        |

`smocket-client` delegates to its exact-version `smocket` peer; it does not own another
server registry. Load both packages through ESM or both through CommonJS so they share the
same module instance. Test-runner aliases should map `socket.io-client` to
`smocket-client`, not to a private `src` or `dist` path.

## SharedWorker boundary

The page creates the browser `SharedWorker` with its URL, name, and module option, then
passes `worker.port` to `smocket-client/shared-worker`. The worker creates `Server`,
registers application handlers, and passes each accepted port to
`smocket/shared-worker`. Neither package chooses the worker URL or lifecycle policy.

The root `smocket` entry does not re-export the SharedWorker bridge. Multi-tab setups
use `smocket/shared-worker` for `attachSharedWorker` and
`smocket-client/shared-worker` for `connectSharedWorker`, keeping worker-host and
page-client ownership visible as recorded in
[ADR 0038](./decisions/0038-shared-worker-is-an-explicit-narrow-facade.md).

See the [SharedWorker workflow](./shared-worker.md) for lifecycle and storage-partition
limits, or the [test-runner guide](./test-runner-integration.md) for Vitest and Jest
substitution examples.
