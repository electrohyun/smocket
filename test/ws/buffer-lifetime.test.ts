import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { closed, setupWs } from './setup-ws';
import type { EventSocket } from './setup-ws';

const ctx = setupWs();
const kinds = [
  'Buffer',
  'offset Uint8Array',
  'offset DataView',
  'ArrayBuffer',
  'SharedArrayBuffer',
] as const;

function input(kind: (typeof kinds)[number]) {
  const storage = kind === 'SharedArrayBuffer' ? new SharedArrayBuffer(8) : new ArrayBuffer(8);
  const bytes = new Uint8Array(storage);
  bytes.set([0, 0, 104, 101, 108, 108, 111, 0]);
  const view = kind === 'Buffer' || kind.startsWith('offset');
  const expected = Buffer.from(view ? bytes.subarray(2, 7) : bytes);
  const data =
    kind === 'Buffer'
      ? Buffer.from(storage, 2, 5)
      : kind === 'offset Uint8Array'
        ? bytes.subarray(2, 7)
        : kind === 'offset DataView'
          ? new DataView(storage, 2, 5)
          : storage;
  return { data, expected, mutate: () => bytes.fill(120) };
}

function collect(socket: EventSocket, count: number) {
  const messages: { data: unknown; binary: unknown }[] = [];
  const done = new Promise<void>((resolve) => {
    socket.on('message', (data, binary) => {
      messages.push({ data, binary });
      if (messages.length === count) resolve();
    });
  });
  return { messages, done };
}

function completion() {
  const calls: unknown[] = [];
  let complete = () => {};
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return {
    calls,
    done,
    callback(error?: Error) {
      calls.push(error);
      complete();
    },
  };
}

describe.each(['client', 'server'] as const)('%s caller byte storage', (side) => {
  async function pair() {
    const { client, socket } = await ctx.createEventPair();
    return side === 'client'
      ? { sender: client, receiver: socket }
      : { sender: socket, receiver: client };
  }

  describe.each(['immediately', 'in the callback'] as const)('changed %s', (timing) => {
    it.each(kinds)('preserves the sent %s bytes', async (kind) => {
      const { sender, receiver } = await pair();
      const { data, expected, mutate } = input(kind);
      const received = collect(receiver, 2);
      const written = completion();

      sender.send(data, (error) => {
        if (timing === 'in the callback') mutate();
        written.callback(error);
      });
      if (timing === 'immediately') mutate();
      sender.send('marker');
      await Promise.all([written.done, received.done]);
      const ended = Promise.all([closed(sender), closed(receiver)]);
      sender.close(1000);
      await ended;

      expect(written.calls).toEqual([null]);
      expect(received.messages).toEqual([
        { data: expected, binary: true },
        { data: Buffer.from('marker'), binary: false },
      ]);
    });
  });

  it('keeps separate message bytes when consecutive sends reuse one Buffer', async () => {
    const { sender, receiver } = await pair();
    const data = Buffer.from('first');
    const received = collect(receiver, 3);
    const first = completion();
    const second = completion();
    const marker = completion();

    sender.send(data, first.callback);
    data.write('other');
    sender.send(data, second.callback);
    data.fill(0);
    sender.send('marker', marker.callback);
    await Promise.all([first.done, second.done, marker.done, received.done]);
    const ended = Promise.all([closed(sender), closed(receiver)]);
    sender.close(1000);
    await ended;

    expect(first.calls).toEqual([null]);
    expect(second.calls).toEqual([null]);
    expect(marker.calls).toEqual([null]);
    expect(received.messages).toEqual([
      { data: Buffer.from('first'), binary: true },
      { data: Buffer.from('other'), binary: true },
      { data: Buffer.from('marker'), binary: false },
    ]);
  });
});
