import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { closed, listening, opened, setupWs } from './setup-ws';
import type { Socket } from './setup-ws';

const ctx = setupWs();

it.each(['not a URL', 'ws://', 'ws://localhost:65536', 'ws://[::1', 'ws://localhost:bad'])(
  'rejects malformed URL %s synchronously',
  (address) => {
    expect(() => ctx.createClient(address)).toThrow(new SyntaxError(`Invalid URL: ${address}`));
  },
);

it.each(['ftp://localhost', 'mailto:someone@example.test'])(
  'rejects unsupported protocol in %s synchronously',
  (address) => {
    expect(() => ctx.createClient(address)).toThrow(
      new SyntaxError(
        'The URL\'s protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"',
      ),
    );
  },
);

it.each(['ws://127.0.0.1/#room', 'https://127.0.0.1/#room'])(
  'rejects a nonempty fragment in %s synchronously',
  (address) => {
    expect(() => ctx.createClient(address)).toThrow(
      new SyntaxError('The URL contains a fragment identifier'),
    );
  },
);

it.each([
  { input: 'HTTP://127.0.0.1:80', expected: 'ws://127.0.0.1/' },
  { input: 'https://127.0.0.1:443', expected: 'wss://127.0.0.1/' },
  { input: 'ws://127.0.0.1:80/a/../chat?room=one', expected: 'ws://127.0.0.1/chat?room=one' },
  { input: 'wss://[::1]:443', expected: 'wss://[::1]/' },
  {
    input: 'ws://127.0.0.1/chat room?room=two words',
    expected: 'ws://127.0.0.1/chat%20room?room=two%20words',
  },
])('normalizes $input before attempting a connection', async ({ input, expected }) => {
  const client = ctx.createClient(input);
  client.on('error', () => {});
  const done = closed(client);
  expect(client.readyState).toBe(0);
  expect(client.url).toBe(expected);
  client.terminate();
  await done;
});

it.each(['#', '%23room'])('accepts URL suffix %s and preserves it in url', async (suffix) => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(server);
  const requestUrl = new Promise<string | undefined>((resolve) => {
    server.once('connection', (_socket, request) => resolve(request.url));
  });
  const client = ctx.createClient(`ws://127.0.0.1:${port}/${suffix}`);
  expect(client.url).toBe(`ws://127.0.0.1:${port}/${suffix}`);
  await opened(client);
  expect(await requestUrl).toBe(suffix === '#' ? '/' : '/%23room');
});

it('snapshots the normalized URL before the caller changes the URL object', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1', path: '/chat' });
  const { port } = await listening(server);
  const requestUrl = new Promise<string | undefined>((resolve) => {
    server.once('connection', (_socket, request) => resolve(request.url));
  });
  const address = new URL(`http://127.0.0.1:${port}/chat?room=one`);
  const client = ctx.createClient(address);
  expect(address.protocol).toBe('ws:');
  address.port = '1';
  address.pathname = '/changed';
  address.search = '?room=two';
  await opened(client);
  expect(client.url).toBe(`ws://127.0.0.1:${port}/chat?room=one`);
  expect(await requestUrl).toBe('/chat?room=one');
});

describe.each(['client', 'server'] as const)('%s close input validation', (side) => {
  async function pair() {
    const { client, socket } = await ctx.createEventPair();
    return side === 'client'
      ? { initiator: client, peer: socket }
      : { initiator: socket, peer: client };
  }

  it.each([999, 1004, 1005, 1006, 1015, 2999, 5000, -1, NaN, Infinity, 1014.5])(
    'rejects code %s after entering CLOSING',
    async (code) => {
      const { initiator, peer } = await pair();
      expect(() => initiator.close(code, 'a'.repeat(124))).toThrow(
        new TypeError('First argument must be a valid error code number'),
      );
      expect(initiator.readyState).toBe(2);
      expect(peer.readyState).toBe(1);
      expect(initiator.close(1000)).toBeUndefined();
      expect(initiator.readyState).toBe(2);
    },
  );

  it.each(['1000', null, true])('rejects non-number code %s', async (code) => {
    const { initiator } = await pair();
    // @ts-expect-error JavaScript callers can pass values outside the declared API.
    expect(() => initiator.close(code)).toThrow(
      new TypeError('First argument must be a valid error code number'),
    );
    expect(initiator.readyState).toBe(2);
  });

  it.each([
    1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 3000, 4999, 3000.75,
  ])('accepts code %s and reports its integer value to both ends', async (code) => {
    const { initiator, peer } = await pair();
    const done = Promise.all([closed(initiator), closed(peer)]);
    expect(initiator.close(code)).toBeUndefined();
    expect(initiator.readyState).toBe(2);
    for (const result of await done) {
      expect(result).toEqual({ code: Math.trunc(code), reason: Buffer.alloc(0) });
    }
  });

  it.each([
    { label: 'ASCII string', reason: 'a'.repeat(124) },
    { label: 'multibyte string', reason: '가'.repeat(42) },
    { label: 'Buffer', reason: Buffer.alloc(124, 'a') },
  ])('rejects a $label reason exceeding 123 bytes', async ({ reason }) => {
    const { initiator, peer } = await pair();
    expect(() => initiator.close(1000, reason)).toThrow(
      new RangeError('The message must not be greater than 123 bytes'),
    );
    expect(initiator.readyState).toBe(2);
    expect(peer.readyState).toBe(1);
  });

  it.each([
    { label: 'empty string', reason: '' },
    { label: 'ASCII boundary', reason: 'a'.repeat(123) },
    { label: 'multibyte boundary', reason: '가'.repeat(41) },
    { label: 'Buffer boundary', reason: Buffer.alloc(123, 'a') },
    { label: 'unpaired surrogate', reason: '\uD800' },
  ])('delivers a $label reason as UTF-8 bytes', async ({ reason }) => {
    const { initiator, peer } = await pair();
    const expected = Buffer.from(reason);
    const done = Promise.all([closed(initiator), closed(peer)]);
    initiator.close(1000, reason);
    if (Buffer.isBuffer(reason)) reason.fill('z');
    for (const result of await done) {
      expect(result.code).toBe(1000);
      expect(Buffer.isBuffer(result.reason)).toBe(true);
      expect(result.reason).toEqual(expected);
    }
  });

  it('ignores an oversized reason when the code is omitted', async () => {
    const { initiator, peer } = await pair();
    const done = Promise.all([closed(initiator), closed(peer)]);
    expect(initiator.close(undefined, '가'.repeat(100))).toBeUndefined();
    for (const result of await done) {
      expect(result).toEqual({ code: 1005, reason: Buffer.alloc(0) });
    }
  });

  it('ignores invalid arguments while already CLOSING or CLOSED', async () => {
    const { initiator, peer } = await pair();
    const done = Promise.all([closed(initiator), closed(peer)]);
    initiator.close(1000, 'first');
    expect(initiator.close(1005, 'a'.repeat(124))).toBeUndefined();
    for (const result of await done) {
      expect(result).toEqual({ code: 1000, reason: Buffer.from('first') });
    }
    expect(initiator.readyState).toBe(3);
    expect(initiator.close(1005, 'a'.repeat(124))).toBeUndefined();
  });
});

it('aborts a CONNECTING socket before validating close arguments', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(server);
  const client: Socket = ctx.createClient(`ws://127.0.0.1:${port}`);
  const errors: Error[] = [];
  client.on('error', (error) => errors.push(error));
  const done = closed(client);
  expect(client.close(1005, 'a'.repeat(124))).toBeUndefined();
  expect(client.readyState).toBe(2);
  expect(await done).toEqual({ code: 1006, reason: Buffer.alloc(0) });
  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).toBe('WebSocket was closed before the connection was established');
});
