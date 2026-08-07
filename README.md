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
  <!-- The landing site. Its interactive demo is still being built, so this points
       at the site and not at a demo. -->
  <a href="https://smocket-site.vercel.app">smocket-site.vercel.app</a>
</p>

> **Status: pre-1.0.** The delivery core is complete and checked against real
> socket.io by a dual-run conformance suite. The public API can still change before
> 1.0.0. See [what a version number promises](docs/conformance.md#what-a-version-number-promises).

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
npm install -D smocket
```

```ts
// chat.test.ts
import { connect, Server } from 'smocket';
import { beforeEach, expect, test } from 'vitest';

const URL = 'http://localhost:3000';

beforeEach(() => {
  // The server your app talks to, wired exactly as in socket.io.
  const io = new Server(URL);

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

That run is green. The file above is a vitest test because the suite here is
vitest, and a project without a runner installs one the way it always would.
smocket does not depend on a test runner and does not care which one you use.

`connect(url)` and `io.on('connection')` are socket.io-client's and socket.io's own
entry points, so the code above is the code an application already has, with the
import changed.

Bob receives what Alice sent, and Alice does not, because `socket.to` excludes the
sender. The test above asserts only the first half, since proving a socket did not
receive something takes the marker pattern rather than a wait, and that is a
[conformance case](docs/conformance.md#broadcast) rather than a first example.

### Where to start from here

| Coming from                                  | Start at                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Vitest                                       | the quick start above, which is a vitest file                                         |
| Jest, or another CJS runner                  | [test-runner integration](docs/test-runner-integration.md#jest)                       |
| An app that imports `socket.io-client`       | [test-runner integration](docs/test-runner-integration.md), which swaps the specifier |
| A hand-written socket mock                   | [the problem](#the-problem)                                                           |
| Wanting to read a program rather than a test | [examples/chat-room](examples/chat-room/)                                             |
| Wanting the exact guarantees                 | [the conformance report](docs/conformance.md)                                         |

An existing application does not have to be rewritten to run against smocket.
smocket exports `io` under socket.io-client's own name, so a test runner pointed
at smocket resolves the app's own import and the app's code runs unchanged.
[Test-runner integration](docs/test-runner-integration.md) has the Vitest and Jest
setups.

## Examples

Runnable programs live in [examples/](examples/), outside the published package.
[chat-room](examples/chat-room/) is one room, two clients, and one broadcast, the
smallest thing that shows an event reaching someone other than the sender. From a
clean checkout, `pnpm install` then `pnpm example:chat-room`. CI runs it on every
push, so it fails rather than rots.

## How it compares

**Against a hand-written mock.** The difference is not effort saved. It is whether
the test can be written at all. A hand-written mock is a listener map, and a
listener map answers "did my handler run." The moment a test needs a second
participant, the question changes to "who received this," and that answer comes
from room membership and the broadcast variant rather than from the socket. That is
the layer smocket reproduces.

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

The suite runs against more than one. A CI job runs the real target on socket.io
4.7 and 4.8, so a behaviour those versions disagreed on fails before it could be
published as settled. Widening that range is how a new version is taken on, and it
is a change to a matrix rather than to the mock.

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

Yes. The package ships both ESM and CJS builds with type declarations for each, and
CI verifies on every run that both resolve, since the substitution path depends on
it. Jest swaps the specifier with `moduleNameMapper`, and
[test-runner integration](docs/test-runner-integration.md#jest) has the setup.
Vitest is the default in the examples here because it is what the suite itself
uses.

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
| [test-runner-integration.md](docs/test-runner-integration.md) | running smocket inside Vitest or Jest, and what keeps its types          |
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

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, commit conventions, and
how pull requests are merged, and [AGENTS.md](AGENTS.md) for how to run the two
test targets.

## Contributors

[![Contributors](https://contrib.rocks/image?repo=electrohyun/smocket)](https://github.com/electrohyun/smocket/graphs/contributors)

## License

MIT. See [LICENSE](LICENSE).
