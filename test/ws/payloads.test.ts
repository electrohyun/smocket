import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { closed, setupWs } from './setup-ws';
import type { EventSocket, SendInput } from './setup-ws';

const ctx = setupWs();

function message(socket: EventSocket) {
  return new Promise<{ data: unknown; binary: unknown }>((resolve) => {
    socket.once('message', (data, binary) => resolve({ data, binary }));
  });
}

const array = Uint8Array.from([104, 101, 108, 108, 111]);
const shared = new SharedArrayBuffer(5);
new Uint8Array(shared).set(array);
const offset = Uint8Array.from([0, ...array, 0]);
const inputs: { label: string; data: SendInput; expected: string; binary: boolean }[] = [
  { label: 'string', data: 'hello', expected: 'hello', binary: false },
  { label: 'number', data: 42, expected: '42', binary: false },
  { label: 'zero', data: 0, expected: '0', binary: false },
  { label: 'Buffer', data: Buffer.from('hello'), expected: 'hello', binary: true },
  { label: 'ArrayBuffer', data: array.buffer, expected: 'hello', binary: true },
  { label: 'SharedArrayBuffer', data: shared, expected: 'hello', binary: true },
  { label: 'offset Uint8Array', data: offset.subarray(1, 6), expected: 'hello', binary: true },
  {
    label: 'offset Uint16Array',
    data: new Uint16Array(Uint8Array.from([0, 0, 104, 105, 0, 0]).buffer, 2, 1),
    expected: 'hi',
    binary: true,
  },
  {
    label: 'offset DataView',
    data: new DataView(offset.buffer, 1, 5),
    expected: 'hello',
    binary: true,
  },
  { label: 'array', data: [...array], expected: 'hello', binary: true },
  { label: 'empty string', data: '', expected: '', binary: false },
  { label: 'empty Buffer', data: Buffer.alloc(0), expected: '', binary: true },
  { label: 'coercible array', data: ['104', true, 256], expected: 'h\u0001\u0000', binary: true },
  { label: 'valueOf string', data: { valueOf: () => 'hello' }, expected: 'hello', binary: true },
  { label: 'valueOf bytes', data: { valueOf: () => array }, expected: 'hello', binary: true },
  {
    label: 'primitive string',
    data: { [Symbol.toPrimitive]: () => 'hello' },
    expected: 'hello',
    binary: true,
  },
];

describe.each(['client', 'server'] as const)('%s selected send API', (side) => {
  async function pair() {
    const { client, socket } = await ctx.createEventPair();
    return side === 'client'
      ? { sender: client, receiver: socket }
      : { sender: socket, receiver: client };
  }

  it.each(inputs)(
    'sends $label with inferred binary=$binary and an asynchronous callback',
    async ({ data, expected, binary }) => {
      const { sender, receiver } = await pair();
      if (data === shared) {
        data = new SharedArrayBuffer(5);
        new Uint8Array(data).set(array);
      }
      const received = message(receiver);
      let synchronous = true;
      const written = new Promise<void>((resolve) => {
        expect(
          sender.send(data, (error) => {
            expect(synchronous).toBe(false);
            expect(error).toBeNull();
            resolve();
          }),
        ).toBeUndefined();
      });
      synchronous = false;
      const result = await received;
      await written;
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.data).toEqual(Buffer.from(expected));
      expect(result.binary).toBe(binary);
    },
  );

  it.each([
    { label: 'binary string', data: 'hello', binary: true, expectedBinary: true },
    { label: 'text bytes', data: Buffer.from('hello'), binary: false, expectedBinary: false },
    {
      label: 'explicit undefined',
      data: Buffer.from('hello'),
      binary: undefined,
      expectedBinary: false,
    },
  ])('honors the binary option for $label', async ({ data, binary, expectedBinary }) => {
    const { sender, receiver } = await pair();
    const received = message(receiver);
    const event = new Promise<unknown>((resolve) => {
      receiver.onmessage = (value: { readonly data: unknown }) => resolve(value.data);
    });
    const written = new Promise<void>((resolve) =>
      sender.send(data, { binary }, (error) => {
        expect(error).toBeNull();
        resolve();
      }),
    );
    expect(await received).toEqual({ data: Buffer.from('hello'), binary: expectedBinary });
    expect(await event).toEqual(expectedBinary ? Buffer.from('hello') : 'hello');
    await written;
  });

  it('switches binaryType between Buffer and ArrayBuffer without changing text messages', async () => {
    const { sender, receiver } = await pair();
    expect(receiver.binaryType).toBe('nodebuffer');
    for (const type of ['arraybuffer', 'nodebuffer'] as const) {
      receiver.binaryType = type;
      const received = message(receiver);
      const event = new Promise<unknown>((resolve) => {
        receiver.onmessage = (value: { readonly data: unknown }) => resolve(value.data);
      });
      sender.send(Buffer.from('hello'));
      const { data, binary } = await received;
      expect(binary).toBe(true);
      expect(await event).toBe(data);
      if (type === 'arraybuffer') {
        expect(data).toBeInstanceOf(ArrayBuffer);
        if (!(data instanceof ArrayBuffer)) throw new Error('Expected ArrayBuffer');
        expect(Buffer.from(data).toString()).toBe('hello');
      } else {
        expect(Buffer.isBuffer(data)).toBe(true);
        expect(data).toEqual(Buffer.from('hello'));
      }
    }
    receiver.binaryType = 'arraybuffer';
    const text = message(receiver);
    sender.send('hello');
    expect(await text).toEqual({ data: Buffer.from('hello'), binary: false });
  });

  it('ignores unsupported binaryType assignments', async () => {
    const { receiver } = await pair();
    // @ts-expect-error Invalid JavaScript assignments must leave the selected value unchanged.
    receiver.binaryType = 'invalid';
    expect(receiver.binaryType).toBe('nodebuffer');
  });

  it('delivers mixed text and byte messages in send order through a final marker', async () => {
    const { sender, receiver } = await pair();
    const received: { data: unknown; binary: unknown }[] = [];
    const marker = new Promise<void>((resolve) => {
      receiver.on('message', (data, binary) => {
        received.push({ data, binary });
        if (Buffer.isBuffer(data) && data.toString() === 'marker') resolve();
      });
    });
    sender.send('first');
    sender.send(Buffer.from('second'));
    sender.send(new Uint8Array([116, 104, 105, 114, 100]));
    sender.send('marker');
    await marker;
    expect(received).toEqual([
      { data: Buffer.from('first'), binary: false },
      { data: Buffer.from('second'), binary: true },
      { data: Buffer.from('third'), binary: true },
      { data: Buffer.from('marker'), binary: false },
    ]);
  });

  it('delivers queued text and bytes before a subsequent close and completes each callback once', async () => {
    const { sender, receiver } = await pair();
    const events: unknown[] = [];
    receiver.on('message', (data, binary) => events.push({ data, binary }));
    receiver.on('close', () => events.push('close'));
    const done = Promise.all([closed(sender), closed(receiver)]);
    const calls: unknown[][] = [];
    const written = Promise.all(
      ['first', Buffer.from('second'), new Uint8Array([116, 104, 105, 114, 100])].map(
        (data) =>
          new Promise<void>((resolve) => {
            const completion: unknown[] = [];
            calls.push(completion);
            sender.send(data, (error) => {
              completion.push(error);
              resolve();
            });
          }),
      ),
    );
    sender.close(1000, 'done');
    expect(sender.readyState).toBe(sender.CLOSING);
    const closeInfo = await done;
    await written;
    expect(events).toEqual([
      { data: Buffer.from('first'), binary: false },
      { data: Buffer.from('second'), binary: true },
      { data: Buffer.from('third'), binary: true },
      'close',
    ]);
    expect(calls).toEqual([[null], [null], [null]]);
    expect(closeInfo).toEqual([
      { code: 1000, reason: Buffer.from('done') },
      { code: 1000, reason: Buffer.from('done') },
    ]);
    expect(sender.readyState).toBe(sender.CLOSED);
    expect(receiver.readyState).toBe(receiver.CLOSED);
  });

  it.each(['OPEN', 'CLOSING', 'CLOSED'] as const)(
    'throws payload conversion errors before scheduling a callback while %s',
    async (state) => {
      const { sender, receiver } = await pair();
      if (state !== 'OPEN') {
        const done = Promise.all([closed(sender), closed(receiver)]);
        sender.close();
        if (state === 'CLOSED') await done;
      }
      const failure = new Error('payload conversion failed');
      let conversions = 0;
      const callbacks: string[] = [];
      expect(() =>
        sender.send(
          {
            valueOf() {
              conversions++;
              throw failure;
            },
          },
          () => callbacks.push('failed conversion'),
        ),
      ).toThrow(failure);
      expect(conversions).toBe(1);
      // A later send callback proves that the failed conversion queued no callback.
      await new Promise<void>((resolve) =>
        sender.send('marker', () => {
          callbacks.push('marker');
          resolve();
        }),
      );
      expect(callbacks).toEqual(['marker']);
    },
  );

  it.each(['CLOSING', 'CLOSED'] as const)(
    'reports a send callback error while %s',
    async (state) => {
      const { sender, receiver } = await pair();
      const received: unknown[] = [];
      receiver.on('message', (data) => received.push(data));
      const done = Promise.all([closed(sender), closed(receiver)]);
      sender.close();
      if (state === 'CLOSED') await done;
      let synchronous = true;
      const written = new Promise<void>((resolve) =>
        sender.send('ignored', (error) => {
          expect(synchronous).toBe(false);
          expect(error).toBeInstanceOf(Error);
          expect(error?.message).toBe(
            `WebSocket is not open: readyState ${state === 'CLOSING' ? 2 : 3} (${state})`,
          );
          resolve();
        }),
      );
      synchronous = false;
      await written;
      await done;
      expect(received).toEqual([]);
    },
  );
});

it('throws on send while CONNECTING before invoking a callback', async () => {
  let conversions = 0;
  const callbacks: string[] = [];
  const { client } = await ctx.createEventPair((client) => {
    expect(() =>
      client.send(
        {
          valueOf() {
            conversions++;
            return 'early';
          },
        },
        () => callbacks.push('early'),
      ),
    ).toThrow('WebSocket is not open: readyState 0 (CONNECTING)');
  });
  await new Promise<void>((resolve) =>
    client.send('marker', () => {
      callbacks.push('marker');
      resolve();
    }),
  );
  expect(conversions).toBe(0);
  expect(callbacks).toEqual(['marker']);
});
