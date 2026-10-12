import http from 'node:http';
import net from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from '../../src/ws/runtime';
import { Server as SocketIOServer } from '../../src/mock-server';

const servers = new Set<WebSocketServer>();
const clients = new Set<WebSocket>();

afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients) client.terminate();
  await Promise.all(
    [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  servers.clear();
  clients.clear();
});

async function serve(options: { port: number; host?: string; path?: string }) {
  const server = new WebSocketServer(options);
  servers.add(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address) throw new Error('Expected a registered address');
  return { server, address };
}

async function connect(url: string) {
  const client = new WebSocket(url);
  clients.add(client);
  await new Promise<void>((resolve, reject) => {
    client.once('error', reject);
    client.once('open', resolve);
  });
  return client;
}

it('exchanges messages without creating an HTTP server or opening a TCP connection', async () => {
  const noNetwork = () => {
    throw new Error('Unexpected network access');
  };
  vi.spyOn(http, 'createServer').mockImplementation(noNetwork);
  vi.spyOn(net, 'connect').mockImplementation(noNetwork);
  vi.spyOn(net, 'createConnection').mockImplementation(noNetwork);
  const { server, address } = await serve({ port: 0 });
  server.once('connection', (socket: WebSocket) => socket.send('hello'));
  const client = new WebSocket(`ws://virtual.example:${address.port}`);
  clients.add(client);
  const message = new Promise<string>((resolve) =>
    client.once('message', (data: Buffer) => resolve(data.toString())),
  );
  await expect(message).resolves.toBe('hello');
  expect(address).toEqual({ address: '::', family: 'IPv6', port: expect.any(Number) });
});

it.each(['localhost', 'LOCALHOST', '0:0:0:0:0:0:0:1'])(
  'matches local aliases for %s without changing the client URL',
  async (host) => {
    const { address } = await serve({ port: 0, host });
    expect(address.address).toBe('::1');
    expect(address.family).toBe('IPv6');
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      const url = `ws://${host}:${address.port}/chat`;
      expect((await connect(url)).url).toBe(url);
    }
  },
);

it('keeps ws registrations alive when a Socket.IO server at the same address closes', async () => {
  const { address } = await serve({ port: 0, host: '127.0.0.1' });
  const socketio = new SocketIOServer(`http://127.0.0.1:${address.port}`);
  try {
    await connect(`ws://127.0.0.1:${address.port}`);
    await socketio.close();
    expect((await connect(`ws://127.0.0.1:${address.port}`)).readyState).toBe(WebSocket.OPEN);
  } finally {
    await socketio.close();
  }
});

it('keeps registrations with the same port on different hosts separate', async () => {
  const first = await serve({ port: 0, host: '192.0.2.1', path: '/chat' });
  const second = await serve({ port: first.address.port, host: '192.0.2.2', path: '/chat' });
  first.server.on('connection', (socket: WebSocket) => socket.send('first'));
  second.server.on('connection', (socket: WebSocket) => socket.send('second'));
  for (const [host, expected] of [
    ['192.0.2.1', 'first'],
    ['192.0.2.2', 'second'],
  ]) {
    const client = new WebSocket(`ws://${host}:${first.address.port}/chat?room=1`);
    clients.add(client);
    const message = new Promise<string>((resolve) =>
      client.once('message', (data: Buffer) => resolve(data.toString())),
    );
    await expect(message).resolves.toBe(expected);
  }
});

it('does not connect a wrong-path client and still accepts a later matching client', async () => {
  const { server, address } = await serve({ port: 0, host: '127.0.0.1', path: '/chat' });
  const accepted: string[] = [];
  server.on('connection', (_socket: WebSocket, request: { url: string }) =>
    accepted.push(request.url),
  );
  const wrong = new WebSocket(`ws://127.0.0.1:${address.port}/other`);
  clients.add(wrong);
  const rejected = new Promise<Error>((resolve) => wrong.once('error', resolve));
  const closed = new Promise<void>((resolve) => wrong.once('close', resolve));
  await expect(rejected).resolves.toBeInstanceOf(Error);
  await closed;
  expect(wrong.readyState).toBe(WebSocket.CLOSED);
  await connect(`ws://127.0.0.1:${address.port}/chat`);
  // A later accepted connection is the marker; no timeout proves non-receipt.
  expect(accepted).toEqual(['/chat']);
});
