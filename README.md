<p align="center">
  <!-- The banner carries the wordmark and the one-line pitch, which is why no
       heading or tagline repeats them here. The alt text is what a reader gets
       when the image does not load, so it says the same thing in words. -->
  <img
    src="https://ik.imagekit.io/electrohyun/smocket.png?tr=w-1280"
    width="100%"
    alt="smocket. Test socket.io without a server. Sweet setup, rocket speed."
  />
</p>

<p align="center">
  <!-- One workflow badge covering both the real and mock jobs; it goes red if
       either target regresses. -->
  <a href="https://github.com/electrohyun/smocket/actions/workflows/ci.yml">
    <img src="https://github.com/electrohyun/smocket/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI (real + mock)" />
  </a>
  <a href="https://github.com/electrohyun/smocket/actions/workflows/published-consumer.yml">
    <img src="https://github.com/electrohyun/smocket/actions/workflows/published-consumer.yml/badge.svg?branch=main" alt="published package consumer" />
  </a>
  <a href="https://www.npmjs.com/package/smocket">
    <img src="https://img.shields.io/npm/v/smocket" alt="npm version" />
  </a>
  <a href="https://codecov.io/gh/electrohyun/smocket">
    <img src="https://img.shields.io/codecov/c/github/electrohyun/smocket" alt="coverage" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/npm/l/smocket" alt="license" />
  </a>
  <a href="CODE_OF_CONDUCT.md">
    <img src="https://img.shields.io/badge/code%20of%20conduct-contributor%20covenant-blue" alt="code of conduct" />
  </a>
</p>

<p align="center">
  <a href="https://smocket-site.vercel.app">smocket-site.vercel.app</a>
</p>

<p align="center">
  <a href="README.ko.md">🇰🇷 한국어</a>
</p>

> **Status: working toward 1.0.0.** The delivery core is complete and checked against real
> socket.io by a dual-run conformance suite. The public API can still change before
> 1.0.0. See the [roadmap to v1.0.0](docs/roadmap.md) and
> [what a version number promises](docs/conformance.md#what-a-version-number-promises).

## The problem

A test needs a socket, so it writes one.

```ts
const socket = {
  handlers: {} as Record<string, (...args: unknown[]) => void>,
  on(event: string, handler: (...args: unknown[]) => void) {
    this.handlers[event] = handler;
  },
  emit(event: string, ...args: unknown[]) {
    this.handlers[event]?.(...args);
  },
};
```

This carries a component through its first few tests. Then the feature it was
written for arrives: someone else is in the room, and the test has to assert that
they received the message and the sender did not.

There is nowhere for that assertion to go. The object above has one `handlers` map,
so `emit` can only reach the sender's own listener. Adding a second one does not
help either, because who receives an event is not a property of a socket. It is
decided by room membership, by namespace, and by which broadcast variant was used,
and none of those exist here. The mock stops at the point the feature starts.

## The solution

Room membership and the broadcast rules are the thing being mocked, rather than
something layered on afterwards.

```ts
io.on('connection', (socket) => {
  socket.on('say', (room: string, text: string) => {
    // Everyone in the room except the sender, which is what `socket.to` means.
    socket.to(room).emit('said', text);
  });
});
```

## Quick start

```bash
npm install -D smocket smocket-client
```

Install both packages at the same version. When a test owns its client
connections, it can import the client facade directly:

```ts
// chat.test.ts
import { connect } from 'smocket-client';
import { Server } from 'smocket';
import { afterEach, beforeEach, expect, test } from 'vitest';

const URL = 'http://localhost:3000';
let io: Server;

beforeEach(() => {
  // The server your app talks to, wired exactly as in socket.io.
  io = new Server(URL);

  io.on('connection', (socket) => {
    socket.on('join', async (room: string, ack: () => void) => {
      await socket.join(room);
      ack();
    });
    socket.on('say', (room: string, text: string) => {
      socket.to(room).emit('said', text);
    });
  });
});

afterEach(async () => {
  await io.close();
});

test('a broadcast reaches the other member of the room', async () => {
  const alice = connect(URL);
  const bob = connect(URL);

  await new Promise<void>((done) => alice.emit('join', 'lobby', done));
  await new Promise<void>((done) => bob.emit('join', 'lobby', done));

  const heard = new Promise((resolve) => bob.on('said', resolve));
  alice.emit('say', 'lobby', 'hello');

  await expect(heard).resolves.toBe('hello');
});
```

```bash
npx vitest run
```

The `afterEach` waits for `close()` to disconnect both clients and remove the
server from smocket's [origin registry](docs/glossary.md#origin-registry), so the
next test starts without this server or its room state.

That run is green. The file above is a Vitest test because the suite here uses
Vitest. Smocket has no runtime dependency on a test runner: runner packages appear
only in the [development dependencies](package.json). Package validation installs
release artifacts outside the checkout, so a workspace resolution cannot hide a
packaging problem. The details live in the
[release-candidate guide](docs/release-candidates.md).

`connect(url)` and `io.on('connection')` are socket.io-client's and socket.io's own
entry points, so the code above keeps the same split between client and server APIs
while changing only their package names.

Bob receives what Alice sent, and Alice does not, because `socket.to` excludes the
sender. The test above asserts only the first half, since proving a socket did not
receive something takes the marker pattern rather than a wait, and that is a
[conformance case](docs/conformance.md#broadcast) rather than a first example.

### Keep an existing application import

An existing application does not have to be rewritten. Keep its
`socket.io-client` import and map that package name to `smocket-client` in the
environment that runs it:

```ts
// application code, unchanged
import { io } from 'socket.io-client';
```

`smocket-client` preserves the supported default, named, ESM, and CommonJS client
imports. Load it and `smocket` through the same module format so both packages use
one in-process registry. The
[test-runner integration guide](docs/test-runner-integration.md) contains the
complete Vitest and Jest setups.

### Where to start from here

| Coming from                                  | Start at                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Vitest                                       | the quick start above, which is a vitest file                                         |
| Jest, or another CJS runner                  | [the documented, executable Jest setup](docs/test-runner-integration.md#jest)         |
| An app that imports `socket.io-client`       | [test-runner integration](docs/test-runner-integration.md), which swaps the specifier |
| A setup that fails before the first event    | [troubleshooting by actual signal](docs/troubleshooting.md)                           |
| A hand-written socket mock                   | [the problem](#the-problem)                                                           |
| Wanting to read a program rather than a test | [examples/chat-room](examples/chat-room/)                                             |
| Wanting the exact guarantees                 | [the conformance report](docs/conformance.md)                                         |

## Examples

Runnable programs live in [examples/](examples/), outside the published package.
[chat-room](examples/chat-room/) follows three participants through two rooms, a
moderated announcement, and a disconnect. From a clean checkout, `pnpm install`
then `pnpm example:chat-room`. CI runs it on every push, so it fails rather than
rots.

The [chat room package consumer](consumers/chat-room/) runs the same application
after npm installs either the released package or a tarball built from a pull
request. It is also available as a
[repository-backed StackBlitz project](https://stackblitz.com/github/electrohyun/smocket).

## How it compares

**Against a hand-written mock.** In the
[one-workflow case study](docs/application-case-study.md), the handwritten mock passed
the same workflow and assertions as real Socket.IO and published Smocket. It had no
package dependency and needed no port; Smocket needed one package dependency and also
needed no port, while real Socket.IO owned the local server and port setup. The
dependency and port setup was therefore simpler for Smocket than for real Socket.IO,
and simpler still for the handwritten target than for Smocket. The separate ownership
tradeoff was that the application owned the handwritten mock's behavior implementation,
while the Smocket package supplied that behavior behind a smaller fixture bootstrap.

It is reasonable to infer that a change to the exercised event or room semantics may
require the application to maintain its handwritten implementation. The study did not
observe such a future change, and its single workflow does not establish a universal
productivity result or describe every handwritten mock.

**Against HTTP mocking.** A different layer, not a different tool for the same job.
HTTP mocking answers what a request returns, at the transport. socket.io's delivery
rules sit above the transport and answer which socket receives an event. A suite
usually wants both, and they do not overlap, so smocket stays off the transport
rather than reaching down into it. See
[decision 0009](docs/decisions/0009-no-raw-websocket-mocking.md).

## Conformance

Every behaviour smocket claims was measured against a real socket.io server first
and against smocket second, from the same test file, and is published only when
both passed. The CI badge above covers both runs, so it goes red if either target
does.

The [conformance report](docs/conformance.md) is generated from that run. It lists
every verified case linked to the test that pins it, the surface not yet measured,
and where the two deliberately differ. Reading it is the fastest way to see how
wide the reproduced surface is, from
[rooms](docs/conformance.md#rooms) and
[broadcast chaining](docs/conformance.md#broadcast-chaining) through
[connection middleware](docs/conformance.md#connection-middleware),
[acknowledgement timeouts](docs/conformance.md#acknowledgement-timeouts),
[volatile emits](docs/conformance.md#volatile-emits),
[catch-all listeners](docs/conformance.md#catch-all-listeners),
[socket.data](docs/conformance.md#socketdata), and
[disconnect](docs/conformance.md#disconnect).

## Compatibility

Each row is answered by a CI job rather than by a claim. The jobs are in
[`ci.yml`](.github/workflows/ci.yml), and the same table with its reasoning is in
the [report](docs/conformance.md#supported-versions).

| Question                              | Answer                                               | Job                   |
| ------------------------------------- | ---------------------------------------------------- | --------------------- |
| Which Node runs the suite             | 22 and 24 on Linux, current LTS on Windows and macOS | `test`                |
| Which Node runs the published package | 20 and up, the floor `engines.node` declares         | `declared node floor` |
| Which socket.io the cases hold for    | 4.7 and 4.8                                          | `real target`         |
| Which browser the mock runs in        | Chromium, mock target only                           | `browser`             |

The package ships ESM and CJS builds with type declarations for both, verified on
every run by `publint` and `arethetypeswrong`.

## Out of scope

These are not unbuilt features. A mock never opens a real connection, so there is
nothing for them to act on, and implementing them would mean inventing behaviour
with no source to check it against.

- **Reconnection behaviour reproduction.** There is no dropped connection to
  re-establish. A trigger that forces a disconnected state, so your own reconnect
  handlers can be exercised, is a separate planned feature.
- **Transport fallback.** There is no WebSocket or HTTP long-polling transport to
  fall back between.
- **Heartbeat.** There is no live connection to ping, so none can time out. The
  disconnect a timeout would cause is still observable through
  `socket.disconnect()`.
- **Multi-server scaling.** One in-memory process has no second server for the
  Redis adapter to reach.
- **Binary encoding.** Nothing is serialised onto a wire, so there are no frames to
  encode.

The full boundary, with the layer split it follows, is in
[scope.md](docs/scope.md).

## FAQ

<details>
<summary>I already mock HTTP. Where does smocket fit?</summary>

HTTP mocking works at the transport, on requests and responses. socket.io's
delivery rules sit above the transport, so getting them out of a transport-level
tool would mean hand-assembling socket.io's wire protocol and then writing rooms,
namespaces, and the broadcast variants on top of it. That is a separate job, and
smocket does that one. See
[decision 0009](docs/decisions/0009-no-raw-websocket-mocking.md).

</details>

<details>
<summary>Can I keep my HTTP mock and add smocket?</summary>

Yes, and that is the intended arrangement. HTTP stays with whatever already answers
it, and sockets come here. Neither patches the other's surface, so a suite runs
both.

</details>

<details>
<summary>Why is there no reconnection?</summary>

Reconnection is a retry over time after a real connection drops. A mock has no
connection to drop and no later to wait for, so any delay it reported would be a
number invented for the occasion. What tests actually want from reconnection is
their own handlers running, and that is reachable by triggering the disconnected
state directly. See [scope.md](docs/scope.md).

</details>

<details>
<summary>Does testing without a real server drift from the backend contract?</summary>

That risk is what the dual run exists to answer, and it is answered for socket.io's
half of the contract. Each case runs against a real socket.io server first, so what
it asserts is socket.io's behaviour, and the same file then runs against smocket. A
divergence fails CI. What smocket cannot check is your own server's handlers, which
is the same thing any mock leaves to a contract or integration test.

</details>

<details>
<summary>What happens when socket.io releases a new version?</summary>

The suite runs against more than one. A CI job typechecks and runs the real target
on socket.io 4.7 and 4.8, so a case or shared contract that does not hold for both
fails before it can be published as settled. Where the versions differ, the
contract admits the measured alternatives and the difference is recorded. Widening
that range is how a new version is taken on, and it is a change to a matrix rather
than to the mock.

</details>

<details>
<summary>Does smocket mock my domain logic?</summary>

No. It reproduces delivery, meaning which socket receives which event, in which
room and namespace, and in what order. Your handlers stay yours, and they run
unchanged. That is why the quick start above is ordinary application code with one
import swapped.

</details>

<details>
<summary>Does it work in Jest, or another CJS runner?</summary>

The package ships both ESM and CJS builds with type declarations for each, and CI
verifies that both resolve. The clean adoption fixture also runs the documented
`moduleNameMapper` setup through a named CommonJS `socket.io-client` import after
installing either a candidate tarball or the exact published package. See
[test-runner integration](docs/test-runner-integration.md#jest).

</details>

<details>
<summary>Why is raw WebSocket out of scope?</summary>

It sits at the transport, and it answers a different question. A raw WebSocket mock
answers what bytes crossed the wire. smocket answers which sockets receive what,
given a set of emits, joins, and broadcasts. Tools that intercept the transport
already cover the first question well. See
[decision 0009](docs/decisions/0009-no-raw-websocket-mocking.md).

</details>

## Documentation

| Document                                                      | What it holds                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [docs/README.md](docs/README.md)                              | the documentation map, by the question you arrived with                  |
| [roadmap.md](docs/roadmap.md)                                 | the guarantees, dependencies, and release path toward v1.0.0             |
| [test-runner-integration.md](docs/test-runner-integration.md) | running smocket inside Vitest or Jest, and what keeps its types          |
| [troubleshooting.md](docs/troubleshooting.md)                 | reproductions, signals, causes, and corrections for adoption failures    |
| [conformance.md](docs/conformance.md)                         | every behaviour verified against real socket.io, generated from the run  |
| [scope.md](docs/scope.md)                                     | the boundary, and the layer split it follows                             |
| [differences.md](docs/differences.md)                         | where smocket diverges on purpose, and what it adds that socket.io lacks |
| [glossary.md](docs/glossary.md)                               | the socket.io terms the other documents use                              |
| [decisions/](docs/decisions/README.md)                        | one record per design decision, with the alternatives rejected           |
| [adapter-registration.md](docs/adapter-registration.md)       | supplying your own adapter to change the routing decision                |
| [CONTRIBUTING-docs.md](docs/CONTRIBUTING-docs.md)             | how documents here are written                                           |
| [labels.md](docs/labels.md)                                   | what the issue and pull request labels mean                              |

Korean versions sit beside the originals as `<name>.ko.md`, with the English
version authoritative where the two diverge.

## Contributing

Contributions are welcome, and the most useful ones encode how socket.io actually
behaves.

The shortest route in is a conformance case, because it is judged mechanically
rather than by taste. The report lists the
[surface no case covers yet](docs/conformance.md#not-covered-yet), and
[how to add a case](docs/conformance.md#how-to-add-a-case) is the procedure. A case
that passes on real socket.io and fails on smocket is a divergence located, and it
arrives with its reproduction already written.

The [milestones](https://github.com/electrohyun/smocket/milestones) show what each
release is aiming for, and the
[issue tracker](https://github.com/electrohyun/smocket/issues) carries the rest.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, where to report or propose work,
commit conventions, and how pull requests are merged. The
[Korean guide](CONTRIBUTING.ko.md) covers the same path. See
[AGENTS.md](AGENTS.md) for how to run the two test targets.

## Contributors

[![Contributors](https://contrib.rocks/image?repo=electrohyun/smocket)](https://github.com/electrohyun/smocket/graphs/contributors)

## License

MIT. See [LICENSE](LICENSE).
