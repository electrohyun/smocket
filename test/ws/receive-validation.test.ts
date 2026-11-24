import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { setupWs } from './setup-ws';
import type { EventSocket } from './setup-ws';

const ctx = setupWs();
const abnormal = { code: 1006, reason: '', wasClean: false };
const invalidUtf8 = {
  name: 'Error',
  code: 'WS_ERR_INVALID_UTF8',
  message: 'Invalid WebSocket frame: invalid UTF-8 sequence',
};

function observe(socket: EventSocket) {
  const events: string[] = [];
  const messages: unknown[] = [];
  const errors: { error: Error; state: number }[] = [];
  const eventErrors: unknown[] = [];
  const closes: { code: number; reason: string; wasClean: boolean }[] = [];
  socket.on('message', (data, binary) => messages.push({ data, binary }));
  socket.on('error', (error) => {
    events.push('error');
    errors.push({ error: error as Error, state: socket.readyState });
  });
  socket.onerror = (event: { error: unknown }) => eventErrors.push(event.error);
  const done = new Promise<void>((resolve) => {
    socket.onclose = (event: { code: number; reason: string; wasClean: boolean }) => {
      events.push('close');
      closes.push({ code: event.code, reason: event.reason, wasClean: event.wasClean });
      resolve();
    };
  });
  return { events, messages, errors, eventErrors, closes, done };
}

function expectFailure(observation: ReturnType<typeof observe>, error: typeof invalidUtf8) {
  expect(observation.errors).toEqual([{ error: expect.objectContaining(error), state: 2 }]);
  expect(observation.eventErrors).toHaveLength(1);
  expect(observation.eventErrors[0]).toBe(observation.errors[0]?.error);
  expect(observation.events).toEqual(['error', 'close']);
  expect(observation.messages).toEqual([]);
  expect(observation.closes).toEqual([abnormal]);
}

describe.each(['client', 'server'] as const)('%s invalid incoming data', (side) => {
  async function pair() {
    const { server, client, socket } = await ctx.createEventPair();
    const sender = side === 'client' ? client : socket;
    const receiver = side === 'client' ? socket : client;
    return { server, sender, receiver, sent: observe(sender), received: observe(receiver) };
  }

  it.each([
    ['invalid lead', [0xff]],
    ['truncated sequence', [0xe2, 0x82]],
    ['overlong sequence', [0xc0, 0xaf]],
    ['surrogate', [0xed, 0xa0, 0x80]],
  ] as const)('rejects %s text and stops later incoming messages', async (_name, bytes) => {
    const { server, sender, sent, received } = await pair();
    const callbacks: unknown[] = [];

    sender.send(Buffer.from(bytes), { binary: false }, (error) => callbacks.push(error));
    sender.send(Buffer.from([0xff]), { binary: false }, (error) => callbacks.push(error));
    sender.send('later message', (error) => callbacks.push(error));
    await Promise.all([sent.done, received.done]);

    expectFailure(received, invalidUtf8);
    expect(sent.errors).toEqual([]);
    expect(sent.closes).toEqual([{ code: 1007, reason: '', wasClean: true }]);
    expect(callbacks).toEqual([null, null, null]);
    expect(server.clients?.size).toBe(0);
  });

  it('accepts the same bytes as binary data', async () => {
    const { sender, receiver, sent, received } = await pair();
    const bytes = Buffer.from([0xff, 0xc0, 0xaf]);
    receiver.once('message', () => receiver.close(1000));

    sender.send(bytes);
    await Promise.all([sent.done, received.done]);

    expect(received.messages).toEqual([{ data: bytes, binary: true }]);
    expect(received.errors).toEqual([]);
    expect(received.closes).toEqual([{ code: 1000, reason: '', wasClean: true }]);
    expect(sent.errors).toEqual([]);
  });

  it('rejects a malformed close reason', async () => {
    const { sender, sent, received } = await pair();

    sender.close(1000, Buffer.from([0xff]));
    await Promise.all([sent.done, received.done]);

    expectFailure(received, invalidUtf8);
    expect(sent.closes).toEqual([{ code: 1007, reason: '', wasClean: true }]);
  });

  it.each([1004.5, 1005.5, 1006.5])(
    'rejects the reserved code produced by truncating %s',
    async (code) => {
      const { sender, sent, received } = await pair();

      sender.close(code);
      await Promise.all([sent.done, received.done]);

      expectFailure(received, {
        name: 'RangeError',
        code: 'WS_ERR_INVALID_CLOSE_CODE',
        message: `Invalid WebSocket frame: invalid status code ${Math.trunc(code)}`,
      });
      expect(sent.closes).toEqual([{ code: 1002, reason: '', wasClean: true }]);
    },
  );

  it('validates the received code before the reason', async () => {
    const { sender, sent, received } = await pair();

    sender.close(1004.5, Buffer.from([0xff]));
    await Promise.all([sent.done, received.done]);

    expectFailure(received, {
      name: 'RangeError',
      code: 'WS_ERR_INVALID_CLOSE_CODE',
      message: 'Invalid WebSocket frame: invalid status code 1004',
    });
    expect(sent.closes).toEqual([{ code: 1002, reason: '', wasClean: true }]);
  });

  it('ignores a malformed reason when no close code was supplied', async () => {
    const { sender, sent, received } = await pair();

    sender.close(undefined, Buffer.from([0xff]));
    await Promise.all([sent.done, received.done]);

    expect(sent.errors).toEqual([]);
    expect(received.errors).toEqual([]);
    expect(sent.closes).toEqual([{ code: 1005, reason: '', wasClean: true }]);
    expect(received.closes).toEqual(sent.closes);
  });

  it('keeps an already-sent close when invalid text arrives during closing', async () => {
    const { sender, receiver, sent, received } = await pair();

    receiver.close(1000, 'normal');
    sender.send(Buffer.from([0xff]), { binary: false });
    await Promise.all([sent.done, received.done]);

    expectFailure(received, invalidUtf8);
    expect(sent.closes).toEqual([{ code: 1000, reason: 'normal', wasClean: true }]);
  });
});
