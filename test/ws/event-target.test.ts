import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { closed, setupWs } from './setup-ws';

interface Event {
  readonly type: string;
  readonly target: unknown;
}
interface MessageEvent extends Event {
  readonly data: unknown;
}
interface CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

const ctx = setupWs();

describe.each(['client', 'accepted'] as const)('%s ws event listeners', (side) => {
  async function pair() {
    const { client, socket } = await ctx.createEventPair();
    return side === 'client'
      ? { receiver: client, peer: socket }
      : { receiver: socket, peer: client };
  }

  it('starts with null event properties and uses a fresh event object for each listener', async () => {
    const { receiver } = await pair();
    expect(receiver.onopen).toBeNull();
    expect(receiver.onmessage).toBeNull();
    expect(receiver.onerror).toBeNull();
    expect(receiver.onclose).toBeNull();
    const events: MessageEvent[] = [];
    receiver.addEventListener('message', (event: MessageEvent) => events.push(event));
    receiver.addEventListener('message', (event: MessageEvent) => events.push(event));
    receiver.emit('message', Buffer.from('hello'), false);
    expect(events).toHaveLength(2);
    expect(events[0]).not.toBe(events[1]);
    expect(events[0]).toMatchObject({ type: 'message', target: receiver, data: 'hello' });
    expect(Reflect.set(events[0] ?? {}, 'data', 'changed')).toBe(false);
    expect(events[0]?.data).toBe('hello');
    const keys: string[] = [];
    for (const key in events[0]) keys.push(key);
    expect(keys).toEqual(['data', 'target', 'type']);
  });

  it('binds function callbacks to the socket and handleEvent callbacks to their object', async () => {
    const { receiver } = await pair();
    const observed: unknown[] = [];
    const listener = function (this: unknown, event: MessageEvent) {
      observed.push(this, event.target, event.data);
    };
    const object = {
      handleEvent(event: MessageEvent) {
        observed.push(this, event.target, event.data);
      },
    };
    expect(receiver.addEventListener('message', listener)).toBeUndefined();
    receiver.addEventListener('message', object);
    receiver.emit('message', Buffer.from('text'), false);
    expect(observed).toEqual([receiver, receiver, 'text', object, receiver, 'text']);
  });

  it('ignores duplicate listener registration and keeps the first once option', async () => {
    const { receiver } = await pair();
    const data: unknown[] = [];
    const listener = (event: MessageEvent) => data.push(event.data);
    const initial = receiver.listenerCount('message');
    receiver.addEventListener('message', listener, { once: true });
    receiver.addEventListener('message', listener);
    expect(receiver.listenerCount('message')).toBe(initial + 1);
    receiver.emit('message', Buffer.from('first'), false);
    receiver.emit('message', Buffer.from('marker'), false);
    expect(data).toEqual(['first']);
    receiver.addEventListener('message', listener);
    receiver.addEventListener('message', listener, { once: true });
    receiver.emit('message', Buffer.from('second'), false);
    receiver.emit('message', Buffer.from('third'), false);
    expect(data).toEqual(['first', 'second', 'third']);
  });

  it('removes an event listener without removing an onmessage property or ordinary emitter callback', async () => {
    const { receiver } = await pair();
    const order: string[] = [];
    const handler = () => order.push('event');
    receiver.onmessage = handler;
    receiver.addEventListener('message', handler, { once: true });
    receiver.on('message', () => order.push('emitter'));
    expect(receiver.removeEventListener('message', handler)).toBeUndefined();
    expect(receiver.onmessage).toBe(handler);
    receiver.emit('message', Buffer.from('marker'), false);
    expect(order).toEqual(['event', 'emitter']);
  });

  it('moves replaced event properties to the end of the listener order and clears them with null', async () => {
    const { receiver } = await pair();
    const order: string[] = [];
    const original = () => order.push('original');
    const replacement = () => order.push('replacement');
    receiver.onmessage = original;
    receiver.addEventListener('message', () => order.push('listener'));
    receiver.onmessage = replacement;
    expect(receiver.onmessage).toBe(replacement);
    receiver.emit('message', Buffer.from('first'), false);
    expect(order).toEqual(['listener', 'replacement']);
    receiver.onmessage = null;
    receiver.emit('message', Buffer.from('marker'), false);
    expect(order).toEqual(['listener', 'replacement', 'listener']);
    expect(receiver.onmessage).toBeNull();
  });

  it('reflects EventEmitter removal in property getters and permits re-registration', async () => {
    const { receiver } = await pair();
    const observed: unknown[] = [];
    const handler = (event: MessageEvent) => observed.push(event.data);
    receiver.onmessage = handler;
    receiver.addEventListener('message', handler);
    receiver.removeAllListeners('message');
    expect(receiver.onmessage).toBeNull();
    receiver.addEventListener('message', handler);
    receiver.emit('message', Buffer.from('marker'), false);
    expect(observed).toEqual(['marker']);
  });

  it('clears an event property when assigned a non-function value', async () => {
    const { receiver } = await pair();
    const order: string[] = [];
    receiver.onmessage = () => order.push('property');
    receiver.on('message', () => order.push('marker'));
    expect(
      Reflect.set(receiver, 'onmessage', {
        handleEvent() {
          order.push('object');
        },
      }),
    ).toBe(true);
    expect(receiver.onmessage).toBeNull();
    receiver.emit('message', Buffer.from('marker'), false);
    expect(order).toEqual(['marker']);
  });

  it('tracks object listeners by identity for duplicate registration and removal', async () => {
    const { receiver } = await pair();
    const observed: unknown[] = [];
    const object = {
      handleEvent(event: MessageEvent) {
        observed.push(event.data);
      },
    };
    receiver.addEventListener('message', object, { once: true });
    receiver.addEventListener('message', object);
    receiver.removeEventListener('message', { handleEvent: object.handleEvent });
    receiver.emit('message', Buffer.from('first'), false);
    receiver.emit('message', Buffer.from('marker'), false);
    expect(observed).toEqual(['first']);
    receiver.addEventListener('message', object);
    receiver.removeEventListener('message', object);
    receiver.on('message', () => observed.push('marker'));
    receiver.emit('message', Buffer.from('marker'), false);
    expect(observed).toEqual(['first', 'marker']);
  });

  it('retains binary event data identity when the underlying emitter supplies bytes', async () => {
    const { receiver } = await pair();
    const bytes = Buffer.from([1, 2, 3]);
    const events: MessageEvent[] = [];
    receiver.addEventListener('message', (event: MessageEvent) => events.push(event));
    receiver.emit('message', bytes, true);
    expect(events[0]?.data).toBe(bytes);
  });

  it('wraps an Error without changing its identity and treats onerror as an error listener', async () => {
    const { receiver } = await pair();
    const error = new Error('application error');
    const observed: unknown[] = [];
    receiver.onerror = function (
      this: unknown,
      event: Event & { error: unknown; message: string },
    ) {
      observed.push(this, event.target, event.error, event.message, event.type);
    };
    receiver.emit('error', error);
    expect(observed).toEqual([receiver, receiver, error, 'application error', 'error']);
  });

  it('uses an empty event message when an emitted error has no message', async () => {
    const { receiver } = await pair();
    const error = new Error('removed');
    Reflect.set(error, 'message', undefined);
    const events: unknown[] = [];
    receiver.addEventListener('error', (event: Event) => events.push(event));
    receiver.emit('error', error);
    expect(events).toEqual([expect.objectContaining({ error, message: '', target: receiver })]);
  });

  it('ignores unsupported event types without removing ordinary emitter listeners', async () => {
    const { receiver } = await pair();
    const observed: string[] = [];
    const listener = () => observed.push('ordinary');
    receiver.on('custom', listener);
    Reflect.apply(receiver.addEventListener, receiver, ['custom', () => observed.push('event')]);
    Reflect.apply(receiver.removeEventListener, receiver, ['custom', listener]);
    expect(receiver.emit('custom')).toBe(true);
    expect(observed).toEqual(['ordinary']);
  });

  it('delivers normal close information as string reason and wasClean=true', async () => {
    const { receiver, peer } = await pair();
    let resolveClose: (event: CloseEvent) => void = () => {};
    const closeEvent = new Promise<CloseEvent>((resolve) => {
      resolveClose = resolve;
    });
    receiver.onclose = function (this: unknown, event: CloseEvent) {
      expect(this).toBe(receiver);
      expect(event.target).toBe(receiver);
      resolveClose(event);
    };
    peer.close(1000, '완료');
    const event = await closeEvent;
    expect(event).toMatchObject({ type: 'close', code: 1000, reason: '완료', wasClean: true });
  });

  it('uses wasClean=false after abrupt termination', async () => {
    const { receiver, peer } = await pair();
    const closeEvent = new Promise<CloseEvent>((resolve) =>
      receiver.addEventListener('close', resolve),
    );
    peer.terminate();
    expect(await closeEvent).toMatchObject({ code: 1006, reason: '', wasClean: false });
  });

  it('delivers real text through the event property while the emitter still receives bytes', async () => {
    const { receiver, peer } = await pair();
    const order: unknown[] = [];
    receiver.on('message', (data: unknown) => order.push(Buffer.isBuffer(data)));
    const message = new Promise<MessageEvent>((resolve) => {
      receiver.onmessage = (event: MessageEvent) => {
        order.push(event.data);
        resolve(event);
      };
    });
    peer.send('hello');
    const event = await message;
    expect(event.target).toBe(receiver);
    expect(order).toEqual([true, 'hello']);
  });
});

it('dispatches an open event with the client as target and callback receiver', async () => {
  const observed: unknown[] = [];
  const { client } = await ctx.createEventPair((client) => {
    client.onopen = function (this: unknown, event: Event) {
      observed.push(this, event.target, event.type);
    };
  });
  expect(observed).toEqual([client, client, 'open']);
  const done = closed(client);
  client.close();
  await done;
  expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(client), 'onopen')?.enumerable).toBe(
    true,
  );
});
