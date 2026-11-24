import { Buffer } from 'node:buffer';
import { expect, it } from 'vitest';
import { listening, opened, setupWs } from './setup-ws';
import type { Server, Socket } from './setup-ws';

const ctx = setupWs();

function stop(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function failure(client: Socket) {
  const events: string[] = [];
  let error: unknown;
  client.on('open', () => events.push(`open:${client.readyState}`));
  client.on('error', (value) => {
    error = value;
    events.push(`error:${client.readyState}`);
  });

  return new Promise<{ events: string[]; error: unknown; code: number; reason: Buffer }>(
    (resolve) =>
      client.once('close', (code, reason) => {
        events.push(`close:${client.readyState}`);
        resolve({ events, error, code, reason });
      }),
  );
}

it('closes a failed connection to a missing server and permits reuse of the address', async () => {
  const original = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(original);
  await stop(original);
  const client = ctx.createClient(`ws://127.0.0.1:${port}`);
  const failed = failure(client);

  const result = await failed;

  expect(result.events).toEqual(['error:2', 'close:3']);
  expect(result.error).toBeInstanceOf(Error);
  expect(result.code).toBe(1006);
  expect(result.reason).toEqual(Buffer.alloc(0));
  expect(client.readyState).toBe(3);

  const replacement = ctx.createServer({ port, host: '127.0.0.1' });
  await listening(replacement);
  const accepted: string[] = [];
  replacement.on('connection', (_socket, request) => accepted.push(request.url ?? ''));

  const next = ctx.createClient(`ws://127.0.0.1:${port}/replacement`);
  await opened(next);

  expect(accepted).toEqual(['/replacement']);
  expect(next.readyState).toBe(1);
});

it.each([
  { label: 'mismatched path', protocol: 'ws', host: '127.0.0.1', path: '/other' },
  { label: 'mismatched host', protocol: 'ws', host: '127.0.0.2', path: '/chat' },
  {
    label: 'secure target against a plain server',
    protocol: 'wss',
    host: '127.0.0.1',
    path: '/chat',
  },
])(
  'rejects a $label before accepting a later matching client',
  async ({ protocol, host, path }) => {
    const server = ctx.createServer({ port: 0, host: '127.0.0.1', path: '/chat' });
    const { port } = await listening(server);
    const accepted: string[] = [];
    server.on('connection', (_socket, request) => accepted.push(request.url ?? ''));
    const client = ctx.createClient(`${protocol}://${host}:${port}${path}`);
    const failed = failure(client);

    const result = await failed;

    expect(result.events).toEqual(['error:2', 'close:3']);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.code).toBe(1006);
    expect(result.reason).toEqual(Buffer.alloc(0));
    expect(client.readyState).toBe(3);

    const next = ctx.createClient(`ws://127.0.0.1:${port}/chat?marker=accepted`);
    await opened(next);

    expect(accepted).toEqual(['/chat?marker=accepted']);
    expect(next.readyState).toBe(1);
  },
);

it.each(['close', 'terminate'] as const)(
  'cancels a CONNECTING client with %s before server admission',
  async (action) => {
    const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
    const { port } = await listening(server);
    const accepted: string[] = [];
    server.on('connection', (_socket, request) => accepted.push(request.url ?? ''));
    const client = ctx.createClient(`ws://127.0.0.1:${port}/cancelled`);
    const failed = failure(client);

    client[action]();

    expect(client.readyState).toBe(2);

    const result = await failed;

    expect(result.events).toEqual(['error:2', 'close:3']);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.code).toBe(1006);
    expect(result.reason).toEqual(Buffer.alloc(0));

    const next = ctx.createClient(`ws://127.0.0.1:${port}/marker`);
    await opened(next);

    expect(accepted).toEqual(['/marker']);
    expect(next.readyState).toBe(1);
  },
);

it('runs stopped-server callbacks on the close event and only once per call', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  await listening(server);
  await stop(server);
  const events: string[] = [];
  const errors: unknown[] = [];
  let closes = 0;
  const done = new Promise<void>((resolve) =>
    server.on('close', () => {
      events.push('close');
      if (++closes === 2) resolve();
    }),
  );

  server.close((error) => {
    events.push('first callback');
    errors.push(error);
  });
  server.close((error) => {
    events.push('second callback');
    errors.push(error);
  });

  expect(events).toEqual([]);

  await done;

  expect(events).toEqual(['close', 'first callback', 'second callback', 'close']);
  expect(errors).toEqual([
    new Error('The server is not running'),
    new Error('The server is not running'),
  ]);
  expect(errors.every((error) => error instanceof Error)).toBe(true);
});
