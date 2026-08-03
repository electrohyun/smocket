import { beforeEach, expect, it, vi } from 'vitest';
import { connect, resetRegistry, Server } from './mock-server';

// These tests exercise `connect(url)` and its origin registry, a smocket-only
// mechanism: real socket.io resolves a url through an actual network, so there is
// no dual-run counterpart to compare against (like the adapter, see
// docs/differences.md §B). They import the Server directly and always run the same
// under both `pnpm test` targets. The registry is a module-level singleton, so it
// is cleared before each test to keep lookups isolated.

beforeEach(() => resetRegistry());

it('connect(url) resolves to the server registered for that origin', async () => {
  const server = new Server('http://localhost');
  const client = connect('http://localhost');
  const serverSocket = await server.nextConnection();

  expect(client.connected).toBe(true);
  expect(serverSocket.id).toBe(client.id);
});

it('handshake.url is the normalized origin the client connected to', async () => {
  // The one mock-only handshake field: real socket.io fills `url` with the request
  // path, smocket with the normalized origin it holds as the registry key (0006), so
  // the exact value is pinned here rather than in the dual-run handshake test.
  const server = new Server('http://localhost');
  connect('http://localhost/game');
  const serverSocket = await server.nextConnection('/game');

  expect(serverSocket.handshake.url).toBe('http://localhost:80');
});

it('two spellings of one origin resolve to the same server', async () => {
  // A missing port is filled from the scheme (http -> 80), so the bare host and
  // the same host with its default port are one key (0003).
  const server = new Server('http://localhost');
  const client = connect('http://localhost:80');
  const serverSocket = await server.nextConnection();

  expect(serverSocket.id).toBe(client.id);
});

it("the url's query string lands on handshake.query", async () => {
  // The url is one of the two sources for `handshake.query`. Reading it off `connect(url)`
  // is mock-only for the same reason as the rest of this file: the mock harness routes
  // through `connect(url)`, whereas real socket.io's url query rides its own network
  // stack. Values arrive as strings, matching how a real querystring is decoded.
  const server = new Server('http://localhost');
  connect('http://localhost/?room=lobby&max=4');
  const serverSocket = await server.nextConnection();

  expect(serverSocket.handshake.query.room).toBe('lobby');
  expect(serverSocket.handshake.query.max).toBe('4');
});

it('connect(url, { auth }) puts the auth object on the handshake', async () => {
  const server = new Server('http://localhost');
  connect('http://localhost', { auth: { token: 't' } });
  const serverSocket = await server.nextConnection();

  expect(serverSocket.handshake.auth).toEqual({ token: 't' });
});

it('the url query wins wholesale over the options query when both are given', async () => {
  // Measured against socket.io-client 4.x: a url carrying a query uses that query and
  // ignores opts.query entirely, so even an opts-only key is dropped. smocket matches,
  // so connect(url, opts) yields the same handshake the real client would.
  const server = new Server('http://localhost');
  connect('http://localhost/?room=fromurl', { query: { room: 'fromopts', only: 'opt' } });
  const serverSocket = await server.nextConnection();

  expect(serverSocket.handshake.query.room).toBe('fromurl');
  expect(serverSocket.handshake.query.only).toBeUndefined();
});

it('the options query is used only when the url carries none', async () => {
  const server = new Server('http://localhost');
  connect('http://localhost', { query: { room: 'fromopts' } });
  const serverSocket = await server.nextConnection();

  expect(serverSocket.handshake.query.room).toBe('fromopts');
});

it("the url's path selects the namespace", async () => {
  const server = new Server('http://localhost');
  const client = connect('http://localhost/game');
  const serverSocket = await server.nextConnection('/game');

  expect(serverSocket.nsp.name).toBe('/game');
  expect(serverSocket.id).toBe(client.id);
});

it('a relative url resolves against location.origin', async () => {
  vi.stubGlobal('location', { origin: 'http://localhost:3000' });
  try {
    const server = new Server('http://localhost:3000');
    const client = connect('/');
    const serverSocket = await server.nextConnection();

    expect(serverSocket.id).toBe(client.id);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('connect(url) to an unregistered origin fires connect_error, without throwing', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const client = connect('http://localhost:9999');
    const error = new Promise<Error>((resolve) => {
      client.on('connect_error', (err: Error) => resolve(err));
    });

    expect(client.connected).toBe(false);
    await expect(error).resolves.toBeInstanceOf(Error);
    // A parallel console.error alongside the event, so a mistyped url is not
    // silent for the common case of no connect_error handler (0005).
    expect(consoleError).toHaveBeenCalledOnce();
  } finally {
    consoleError.mockRestore();
  }
});
