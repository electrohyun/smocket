import { describe, expect, it } from 'vitest';
import { listening, opened, setupWs } from './setup-ws';
import type { CustomEmitter, Listener, Socket } from './setup-ws';

const ctx = setupWs();

describe.each(['server', 'client socket', 'accepted socket'] as const)(
  '%s EventEmitter',
  (side) => {
    async function receiver(): Promise<CustomEmitter> {
      const server = ctx.createServer({ port: 0, host: '127.0.0.1' });
      await listening(server);
      if (side === 'server') return server;
      const accepted = new Promise<Socket>((resolve) => server.once('connection', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected an IP address');
      const client = ctx.createClient(`ws://127.0.0.1:${address.port}`);
      await opened(client);
      return side === 'client socket' ? client : accepted;
    }

    it('returns its receiver from registration/removal and uses Node method aliases', async () => {
      const emitter = await receiver();
      const listener = () => {};
      expect(emitter.on).toBe(emitter.addListener);
      expect(emitter.off).toBe(emitter.removeListener);
      expect(emitter.on('sample', listener)).toBe(emitter);
      expect(emitter.addListener('sample', listener)).toBe(emitter);
      expect(emitter.once('sample', listener)).toBe(emitter);
      expect(emitter.off('sample', listener)).toBe(emitter);
      expect(emitter.removeListener('sample', listener)).toBe(emitter);
      expect(emitter.removeAllListeners('sample')).toBe(emitter);
      expect(emitter.removeAllListeners()).toBe(emitter);
    });

    it('emits synchronously in registration order with duplicate listeners, arguments, and receiver', async () => {
      const emitter = await receiver();
      const observed: unknown[] = [];
      const first = function (this: CustomEmitter, ...args: unknown[]) {
        expect(this).toBe(emitter);
        observed.push(['first', ...args]);
      };
      const second = () => observed.push(['second']);
      expect(emitter.emit('sample', 1)).toBe(false);
      emitter.on('sample', first).addListener('sample', second).on('sample', first);
      expect(emitter.listeners('sample')).toEqual([first, second, first]);
      expect(emitter.listenerCount('sample')).toBe(3);
      expect(emitter.listenerCount('sample', first)).toBe(2);
      expect(emitter.emit('sample', 1, 'two')).toBe(true);
      expect(observed).toEqual([['first', 1, 'two'], ['second'], ['first', 1, 'two']]);
    });

    it('removes the most recently registered matching listener and ignores missing listeners', async () => {
      const emitter = await receiver();
      const duplicate = () => {};
      const middle = () => {};
      emitter.on('sample', duplicate).on('sample', middle).once('sample', duplicate);
      emitter.removeListener('sample', () => {});
      expect(emitter.listenerCount('sample', duplicate)).toBe(2);
      emitter.off('sample', duplicate);
      expect(emitter.rawListeners('sample')).toEqual([duplicate, middle]);
      emitter.removeListener('sample', duplicate);
      expect(emitter.listeners('sample')).toEqual([middle]);
      emitter.removeAllListeners('sample');
      emitter.on('sample', duplicate).on('sample', middle).on('sample', duplicate);
      emitter.off('sample', duplicate);
      expect(emitter.listeners('sample')).toEqual([duplicate, middle]);
    });

    it('returns fresh listener snapshots and exposes once wrappers before and after emit', async () => {
      const emitter = await receiver();
      const normal = () => {};
      const once = () => {};
      emitter.on('sample', normal).once('sample', once);
      const listeners = emitter.listeners('sample');
      const raw = emitter.rawListeners('sample');
      expect(listeners).toEqual([normal, once]);
      expect(raw).not.toBe(emitter.rawListeners('sample'));
      expect(listeners).not.toBe(emitter.listeners('sample'));
      expect(raw[0]).toBe(normal);
      expect(raw[1]).not.toBe(once);
      expect(raw[1]?.listener).toBe(once);
      expect(emitter.listenerCount('sample', raw[1])).toBe(1);
      listeners.length = 0;
      raw.pop();
      expect(emitter.listenerCount('sample')).toBe(2);
      emitter.emit('sample');
      expect(emitter.listeners('sample')).toEqual([normal]);
      expect(emitter.rawListeners('sample')).toEqual([normal]);
    });

    it('runs a raw once wrapper only once and binds its owner even when called with a different receiver', async () => {
      const emitter = await receiver();
      const observed: unknown[][] = [];
      const listener = function (this: CustomEmitter, ...args: unknown[]) {
        expect(this).toBe(emitter);
        observed.push(args);
      };
      emitter.once('sample', listener);
      const wrapper = emitter.rawListeners('sample')[0];
      if (!wrapper) throw new Error('Expected a once wrapper');
      wrapper.call({}, 'manual', 42);
      wrapper('again');
      expect(emitter.emit('sample', 'after')).toBe(false);
      expect(observed).toEqual([['manual', 42]]);
      expect(emitter.listeners('sample')).toEqual([]);
    });

    it('allows a raw wrapper listener to be called without consuming the once registration', async () => {
      const emitter = await receiver();
      const observed: unknown[] = [];
      const listener: Listener = (value) => observed.push(value);
      emitter.once('sample', listener);
      emitter.rawListeners('sample')[0]?.listener?.('direct');
      expect(emitter.listenerCount('sample', listener)).toBe(1);
      emitter.emit('sample', 'event');
      expect(observed).toEqual(['direct', 'event']);
      expect(emitter.listenerCount('sample')).toBe(0);
    });

    it('does not rerun a once listener when an earlier listener recursively emits the event', async () => {
      const emitter = await receiver();
      const order: string[] = [];
      let nested = false;
      emitter.on('sample', () => {
        order.push('normal');
        if (!nested) {
          nested = true;
          emitter.emit('sample');
        }
      });
      emitter.once('sample', () => order.push('once'));
      emitter.emit('sample');
      expect(order).toEqual(['normal', 'normal', 'once']);
    });

    it('takes a dispatch snapshot when listeners add or remove other listeners', async () => {
      const emitter = await receiver();
      const order: string[] = [];
      const removed = () => order.push('removed');
      const added = () => order.push('added');
      emitter.on('sample', () => {
        order.push('first');
        emitter.off('sample', removed).on('sample', added);
      });
      emitter.on('sample', removed);
      emitter.emit('sample');
      expect(order).toEqual(['first', 'removed']);
      order.length = 0;
      emitter.emit('sample');
      expect(order).toEqual(['first', 'added']);
    });

    it('consumes a once registration before propagating its callback exception', async () => {
      const emitter = await receiver();
      const failure = new Error('listener failure');
      const order: string[] = [];
      emitter.once('sample', () => {
        throw failure;
      });
      emitter.on('sample', () => order.push('after'));
      expect(() => emitter.emit('sample')).toThrow(failure);
      expect(order).toEqual([]);
      expect(emitter.listenerCount('sample')).toBe(1);
      expect(emitter.emit('sample')).toBe(true);
      expect(order).toEqual(['after']);
    });

    it('removes symbol listeners in reverse order while preserving other events', async () => {
      const emitter = await receiver();
      const event = Symbol('custom');
      const observed: unknown[] = [];
      const first = () => {};
      const once = () => {};
      const last = () => {};
      emitter.on('removeListener', (name, callback) => {
        if (name === event) observed.push(callback);
      });
      emitter.on('other', first).on(event, first).once(event, once).on(event, last);
      const wrapper = emitter.rawListeners(event)[1];
      expect(wrapper?.listener).toBe(once);
      expect(emitter.emit(event, 'symbol payload')).toBe(true);
      expect(observed).toEqual([wrapper]);
      emitter.removeAllListeners(event);
      expect(observed).toEqual([wrapper, last, first]);
      expect(emitter.listenerCount(event)).toBe(0);
      expect(emitter.listenerCount('other')).toBe(1);
    });

    it('orders integer event names before other strings and symbols and returns a snapshot', async () => {
      const emitter = await receiver();
      const initial = emitter.eventNames();
      const symbol = Symbol('custom');
      const listener = () => {};
      emitter
        .on('z', listener)
        .on('10', listener)
        .on('2', listener)
        .on(symbol, listener)
        .on('a', listener);
      expect(emitter.eventNames()).toEqual(['2', '10', ...initial, 'z', 'a', symbol]);
      const names = emitter.eventNames();
      names.length = 0;
      emitter.removeAllListeners(symbol);
      expect(emitter.eventNames()).not.toContain(symbol);
      expect(emitter.emit(symbol)).toBe(false);
      expect(emitter.listenerCount('z')).toBe(1);
    });

    it('distinguishes an omitted removeAllListeners argument from explicit undefined', async () => {
      const emitter = await receiver();
      const listener = () => {};
      const removed: unknown[] = [];
      emitter.on('removeListener', (event) => removed.push(event));
      emitter.on('sample', listener).on('undefined', listener);
      expect(emitter.removeAllListeners(undefined)).toBe(emitter);
      expect(emitter.listenerCount('sample')).toBe(1);
      expect(emitter.listenerCount('undefined')).toBe(0);
      expect(removed).toEqual([undefined]);
      emitter.removeAllListeners();
      expect(emitter.eventNames()).toEqual([]);
    });

    it('emits usable newListener/removeListener notifications with unwrapped once callbacks', async () => {
      const emitter = await receiver();
      const observed: unknown[][] = [];
      const listener = () => {};
      emitter.on('newListener', (event, callback) => {
        if (event === 'sample') observed.push(['add', callback, emitter.listenerCount('sample')]);
      });
      emitter.on('removeListener', (event, callback) => {
        if (event === 'sample')
          observed.push(['remove', callback, emitter.listenerCount('sample')]);
      });
      emitter.once('sample', listener);
      emitter.emit('sample');
      expect(observed).toEqual([
        ['add', listener, 0],
        ['remove', listener, 0],
      ]);
    });

    it('rethrows an unhandled Error object and delivers handled errors synchronously', async () => {
      const emitter = await receiver();
      emitter.removeAllListeners('error');
      const error = new Error('application failure');
      expect(() => emitter.emit('error', error)).toThrow(error);
      expect(() => emitter.emit('error', 'application failure')).toThrow(Error);
      const observed: unknown[] = [];
      emitter.on('error', (value) => observed.push(value));
      expect(emitter.emit('error', error)).toBe(true);
      expect(observed).toEqual([error]);
    });
  },
);
