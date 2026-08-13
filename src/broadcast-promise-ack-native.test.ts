import { expect, it } from 'vitest';
import { Server } from './mock-server';
import { receive, track } from './test-events';

it('volatile Promise collection excludes pre-connect recipients from its expected count', async () => {
  const io = new Server('http://broadcast-promise-pre-connect');
  let collected: Promise<unknown> | undefined;
  io.on('connection', (socket) => {
    collected = io.volatile.timeout(100).emitWithAck('question');
    socket.emit('marker', 'connected');
  });
  const client = io.connect();
  const dropped = track(client, 'question');
  const marker = receive(client, 'marker');
  client.on('question', (ack: (value: string) => void) => ack('unexpected'));

  await expect(marker).resolves.toBe('connected');
  await expect(collected).resolves.toEqual([]);
  expect(dropped.received).toBe(false);
  client.disconnect();
  await io.close();
});
