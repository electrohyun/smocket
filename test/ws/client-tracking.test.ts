import { Buffer } from 'node:buffer';
import { expect, it } from 'vitest';
import { closed, opened, setupWs } from './setup-ws';
import type { EventSocket, Socket } from './setup-ws';

const ctx = setupWs();

function message(socket: EventSocket) {
  return new Promise<{ data: unknown; binary: unknown }>((resolve) => {
    socket.once('message', (data, binary) => resolve({ data, binary }));
  });
}

function messagesUntil(socket: Pick<Socket, 'on'>, marker: string): Promise<string[]> {
  return new Promise((resolve) => {
    const received: string[] = [];
    socket.on('message', (data, isBinary) => {
      expect(Buffer.isBuffer(data)).toBe(true);
      expect(isBinary).toBe(false);
      const text = data.toString();
      received.push(text);
      if (text === marker) resolve(received);
    });
  });
}

it.each([
  { setting: 'omitted', options: {} },
  { setting: 'true', options: { clientTracking: true } },
  { setting: 'false', options: { clientTracking: false } },
  { setting: 'explicit undefined', options: { clientTracking: undefined } },
])('tracks accepted sockets with the $setting setting', async ({ options }) => {
  const { server, client, socket } = await ctx.createEventPair(undefined, options);
  const tracked = !Object.hasOwn(options, 'clientTracking') || options.clientTracking === true;

  expect(Object.hasOwn(server, 'clients')).toBe(tracked);
  expect(socket.listenerCount('close')).toBe(tracked ? 1 : 0);
  if (tracked) {
    expect(server.clients).toBeInstanceOf(Set);
    expect(server.clients?.size).toBe(1);
    expect([...(server.clients ?? [])]).toEqual([socket]);
  } else {
    expect(server.clients).toBeUndefined();
  }

  const clients = server.clients;
  let countDuringClose: number | undefined;
  socket.once('close', () => {
    countDuringClose = server.clients?.size;
  });
  const done = Promise.all([closed(client), closed(socket)]);

  client.close();
  await done;

  expect(server.clients).toBe(clients);
  expect(countDuringClose).toBe(tracked ? 0 : undefined);
  if (tracked) expect(clients?.size).toBe(0);
});

it('broadcasts through the public clients set to every accepted socket', async () => {
  const { server, client } = await ctx.createEventPair();
  if (!client.url) throw new Error('Expected client URL');
  const next = ctx.createClient(client.url);
  await opened(next);

  const firstMessage = message(client);
  const nextMessage = new Promise<unknown>((resolve) => next.once('message', resolve));
  expect(server.clients?.size).toBe(2);

  for (const socket of server.clients ?? []) {
    const sender: { send(data: string): void } = socket;
    sender.send('broadcast');
  }

  expect(await firstMessage).toEqual({ data: Buffer.from('broadcast'), binary: false });
  expect(await nextMessage).toEqual(Buffer.from('broadcast'));
});

it('retains the same client set across additional connections and disconnections', async () => {
  const { server, client, socket } = await ctx.createEventPair();
  if (!client.url) throw new Error('Expected client URL');
  const clients = server.clients;
  const next = ctx.createClient(client.url);
  await opened(next);

  expect(server.clients).toBe(clients);
  expect(clients?.size).toBe(2);
  const disconnected = Promise.all([closed(client), closed(socket)]);

  client.close();
  await disconnected;

  expect(server.clients).toBe(clients);
  expect(clients?.size).toBe(1);
  expect([...(clients ?? [])]).not.toContain(socket);

  const replacement = ctx.createClient(client.url);
  await opened(replacement);

  expect(server.clients).toBe(clients);
  expect(clients?.size).toBe(2);
});

it.each([
  { includeSender: true, label: 'including the sender' },
  { includeSender: false, label: 'excluding the sender' },
])('forwards consecutive text messages in order $label', async ({ includeSender }) => {
  const { server, client } = await ctx.createEventPair();
  if (!client.url) throw new Error('Expected client URL');
  const second = ctx.createClient(client.url);
  const third = ctx.createClient(client.url);
  await Promise.all([opened(second), opened(third)]);
  expect(server.clients?.size).toBe(3);

  const marker = 'delivery marker';
  for (const sender of server.clients ?? []) {
    const source: Pick<Socket, 'on'> = sender;
    source.on('message', (data) => {
      const text = data.toString();
      for (const recipient of server.clients ?? []) {
        if (
          recipient.readyState === recipient.OPEN &&
          (includeSender || recipient !== sender || text === marker)
        ) {
          recipient.send(text);
        }
      }
    });
  }
  const received = [client, second, third].map((socket) => messagesUntil(socket, marker));

  client.send('first');
  client.send('second');
  client.send(marker);
  const messages = await Promise.all(received);

  // Each connection's later marker proves both order and absence of excluded text.
  expect(messages).toEqual([
    includeSender ? ['first', 'second', marker] : [marker],
    ['first', 'second', marker],
    ['first', 'second', marker],
  ]);
});

it.each([
  { label: 'false', options: { clientTracking: false } },
  { label: 'explicit undefined', options: { clientTracking: undefined } },
])('owns established sockets with clientTracking $label', async ({ options }) => {
  const { server, client, socket } = await ctx.createEventPair(undefined, options);
  let serverClosed = false;
  const stopped = new Promise<void>((resolve) =>
    server.close(() => {
      serverClosed = true;
      resolve();
    }),
  );
  const received = message(client);

  socket.send('connection marker');
  expect(await received).toEqual({ data: Buffer.from('connection marker'), binary: false });

  expect(server.clients).toBeUndefined();
  expect(serverClosed).toBe(false);
  expect(socket.readyState).toBe(socket.OPEN);
  const disconnected = Promise.all([closed(client), closed(socket)]);

  client.close();
  await Promise.all([disconnected, stopped]);

  expect(serverClosed).toBe(true);
});
