import { Buffer } from 'node:buffer';
import { expect, it } from 'vitest';
import { closed, opened, setupWs } from './setup-ws';
import type { EventSocket } from './setup-ws';

const ctx = setupWs();

function message(socket: EventSocket) {
  return new Promise<{ data: unknown; binary: unknown }>((resolve) => {
    socket.once('message', (data, binary) => resolve({ data, binary }));
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
  const done = Promise.all([closed(client), closed(socket)]);
  client.close();
  await done;
  expect(server.clients).toBe(clients);
  if (tracked) expect(server.clients?.size).toBe(0);
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
