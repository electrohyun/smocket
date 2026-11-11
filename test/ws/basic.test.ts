import { Buffer } from 'node:buffer';
import { expect, it } from 'vitest';
import { closed, listening, opened, setupWs } from './setup-ws';
import type { Socket } from './setup-ws';
import type { AddressInfo } from '../../src/ws/contracts';

const ctx = setupWs();

it('assigns a port and exposes address() through a separate constructor callback receiver', async () => {
  let callbackAddress: AddressInfo | null | undefined;
  const order: string[] = [];
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' }, function () {
    expect(this).not.toBe(server);
    callbackAddress = this.address();
    order.push('callback');
  });
  server.on('listening', () => order.push('listening'));
  const address = await listening(server);
  expect(address).toEqual({ address: '127.0.0.1', family: 'IPv4', port: expect.any(Number) });
  expect(address.port).toBeGreaterThan(0);
  expect(callbackAddress).toEqual(address);
  expect(order).toEqual(['callback', 'listening']);
});

it('connects asynchronously and supplies request basics and socket-side URLs', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1', path: '/chat' });
  const { port } = await listening(server);
  const connection = new Promise<Socket>((resolve) => {
    server.once('connection', (socket, request) => {
      expect(socket.readyState).toBe(1);
      expect(socket.url).toBeUndefined();
      expect(request.url).toBe('/chat?room=one');
      expect(request.method).toBe('GET');
      expect(request.headers).toMatchObject({
        host: `127.0.0.1:${port}`,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
      });
      expect(request.headers['sec-websocket-key']).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      resolve(socket);
    });
  });
  const client = ctx.createClient(`ws://127.0.0.1:${port}/chat?room=one`);
  expect(client.readyState).toBe(0);
  expect(client.url).toBe(`ws://127.0.0.1:${port}/chat?room=one`);
  await opened(client);
  await connection;
  expect(client.readyState).toBe(1);
});

it('delivers text as Buffer with isBinary=false in both directions, including an immediate server greeting', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(server);
  server.on('connection', (socket) => {
    socket.send('greeting');
    socket.on('message', (data, isBinary) => {
      expect(Buffer.isBuffer(data)).toBe(true);
      expect(isBinary).toBe(false);
      expect(data.toString()).toBe('안녕');
      socket.send(`reply:${data.toString()}`);
    });
  });
  const client = ctx.createClient(`ws://127.0.0.1:${port}`);
  const messages: string[] = [];
  client.once('open', () => messages.push('open'));
  const reply = new Promise<void>((resolve) =>
    client.on('message', (data, isBinary) => {
      expect(Buffer.isBuffer(data)).toBe(true);
      expect(isBinary).toBe(false);
      messages.push(data.toString());
      if (messages.length === 3) resolve();
    }),
  );
  await opened(client);
  client.send('안녕');
  await reply;
  expect(messages).toEqual(['open', 'greeting', 'reply:안녕']);
});

it.each([
  { side: 'client', code: undefined },
  { side: 'client', code: 1000 },
  { side: 'server', code: undefined },
  { side: 'server', code: 1000 },
])(
  'closes both ends normally from $side with code $code and a Buffer reason',
  async ({ side, code }) => {
    const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
    const { port } = await listening(server);
    const accepted = new Promise<Socket>((resolve) => server.once('connection', resolve));
    const client = ctx.createClient(`ws://127.0.0.1:${port}`);
    await opened(client);
    const socket = await accepted;
    const clientClosed = closed(client);
    const serverClosed = closed(socket);
    const initiator = side === 'client' ? client : socket;
    initiator.close(code, 'done');
    expect(initiator.readyState).toBe(2);
    for (const close of await Promise.all([clientClosed, serverClosed])) {
      expect(close.code).toBe(code ?? 1005);
      expect(Buffer.isBuffer(close.reason)).toBe(true);
      expect(close.reason.toString()).toBe(code === undefined ? '' : 'done');
    }
    expect(client.readyState).toBe(3);
    expect(socket.readyState).toBe(3);
  },
);

it('releases a server registration so the same address can be used again', async () => {
  const first = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(first);
  const client = ctx.createClient(`ws://127.0.0.1:${port}`);
  await opened(client);
  const done = closed(client);
  client.close();
  await done;
  await new Promise<void>((resolve) => first.close(() => resolve()));
  expect(first.address()).toBeNull();
  const next = ctx.createServer({ port, host: '127.0.0.1' });
  expect((await listening(next)).port).toBe(port);
  const nextClient = ctx.createClient(`ws://127.0.0.1:${port}`);
  await opened(nextClient);
});

it('normalizes HTTP URLs and rejects invalid URLs synchronously', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(server);
  const client = ctx.createClient(new URL(`http://127.0.0.1:${port}`));
  expect(client.url).toBe(`ws://127.0.0.1:${port}/`);
  await opened(client);
  expect(() => ctx.createClient('not a URL')).toThrow(SyntaxError);
  expect(() => ctx.createClient(`ws://127.0.0.1:${port}/#fragment`)).toThrow(SyntaxError);
  expect(() => ctx.createClient('ftp://localhost')).toThrow(SyntaxError);
});

it('rejects sends before open and ignores sends during and after normal close', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(server);
  const received: string[] = [];
  const peerClosed = new Promise<void>((resolve) => {
    server.on('connection', (socket) => {
      socket.on('message', (data) => received.push(data.toString()));
      socket.on('close', () => {
        received.push('close marker');
        resolve();
      });
    });
  });
  const client = ctx.createClient(`ws://127.0.0.1:${port}`);
  expect(() => client.send('before open')).toThrow(
    'WebSocket is not open: readyState 0 (CONNECTING)',
  );
  await opened(client);
  const done = closed(client);
  client.close();
  expect(client.send('during close')).toBeUndefined();
  await Promise.all([done, peerClosed]);
  expect(client.send('after close')).toBeUndefined();
  // The peer's later close event marks the end of its incoming delivery sequence.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  expect(received).toEqual(['close marker']);
});

it('reports an address collision without unregistering the listening server', async () => {
  const first = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(first);
  const duplicate = ctx.createServer({ port, host: '127.0.0.1' });
  const error = await new Promise<Error>((resolve) => duplicate.once('error', resolve));
  expect(error).toMatchObject({ code: 'EADDRINUSE' });
  expect(duplicate.address()).toBeNull();
  await new Promise<void>((resolve) => duplicate.close(() => resolve()));
  const client = ctx.createClient(`ws://127.0.0.1:${port}`);
  await opened(client);
});

it('waits for connected sockets before completing server close callbacks', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  const { port } = await listening(server);
  const client = ctx.createClient(`ws://127.0.0.1:${port}`);
  await opened(client);
  const order: string[] = [];
  server.on('close', () => order.push('close'));
  const first = new Promise<void>((resolve) =>
    server.close(() => {
      order.push('first callback');
      resolve();
    }),
  );
  const second = new Promise<void>((resolve) =>
    server.close(() => {
      order.push('second callback');
      resolve();
    }),
  );
  expect(server.address()).toBeNull();
  expect(order).toEqual([]);
  const done = closed(client);
  client.close();
  await Promise.all([first, second, done]);
  expect(order).toEqual(['close', 'first callback', 'second callback']);
});

it('emits close again when closing a stopped server without a callback', async () => {
  const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
  await listening(server);
  const order: string[] = [];
  server.on('close', () => order.push('close'));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const done = new Promise<void>((resolve) => server.once('close', resolve));
  server.close();
  await done;
  expect(order).toEqual(['close', 'close']);
});
