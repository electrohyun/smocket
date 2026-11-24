# ws package review notes

> **TL;DR** smocket/ws binds its in-memory constructors to the selected public contract and
> generates ESM/CJS declarations. Isolated consumers check one packed artifact;
> package success does not establish full ws behavioral compatibility.

## Implementation choices

[`ws.ts`](../src/ws.ts) assigns actual constructors to the contract structurally,
without casting a partial implementation to the whole contract. Its public exports
describe application APIs without exposing internal classes or requiring Node types.
Default/named constructor identity and CommonJS's explicit default lookup follow
[0045](./decisions/0045-ws-commonjs-uses-default-export.md).

The constructor's address controls the URL type; the server's tracking option
controls clients. TypeScript cannot narrow a generic parameter from a runtime branch,
so assertions are confined to the URL getter and guarded clients initialization.
They do not substitute for implementing public methods. Typed constructor bindings
and consumer examples separately check the resulting relationships.

Real ws supplies null to successful send callbacks even though its declaration uses
an optional Error. The selected type preserves that upstream declaration; the runtime
uses Reflect.apply only for the null success argument. Error callbacks receive Error.
Changing successful calls to undefined would differ from observed ws behavior.

The Node-only entry uses Node Buffer under [0044](./decisions/0044-ws-api-without-transport.md).
The import guard permits buffer/node:buffer only in ws bundles. Browser-facing root
and SharedWorker entries retain zero external imports; package dependencies stay empty.
ESM and CJS own separate registries, so each server/client pair uses the same loader.

## Validation limits

[`check-ws-package.mjs`](../scripts/check-ws-package.mjs) installs the same tarball in
independent TS 5.0.2/6.0.3 consumers, with and without Node types. NodeNext exercises
ESM/CJS declarations; Bundler exercises import declarations. Examples check Buffer
assignments, constructor aliases, client URL types, and client-tracking inference.
Runtime checks load both formats and repeat connection, byte/text exchange, send
callbacks, normal close, and cleanup. The release-candidate gate uses its digest-checked
root tarball for these checks. Test-only fixture mode exercises the checker separately.

[`payloads.test.ts`](../test/ws/payloads.test.ts) compares selected sends, binary
overrides, and live binaryType changes against real ws.
[`client-tracking.test.ts`](../test/ws/client-tracking.test.ts) separately compares
client membership and an all-client broadcast.
The [failure](./ws-failure-review.md), [close-race](./ws-close-races-review.md), and
[receive validation](./ws-receive-validation-review.md) reviews describe the lifecycle
comparisons. The payload review also covers changes to caller-owned byte storage.
TLS, transport, browser-native WebSocket, and Blob remain outside the selected scope.
