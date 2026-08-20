import type { ConnectOptions, Handshake, SmocketAdapter } from '../contract';

export interface DeliveryTarget {
  scheduleReceive(deliver: () => void): void;
  dispatch(event: string, args: unknown[]): void;
}

/**
 * smocket's in-memory core. No HTTP server, no port, no transport: a client and
 * its server-side socket are paired directly in memory (decision ??). It is the
 * `mock` half of the dual-run suite, standing in for a real socket.io server and
 * reproducing its behaviour over the surface the conformance tests exercise, from
 * the connect / disconnect lifecycle through emit/on acks, rooms, broadcast, and
 * per-namespace isolation. What must be reproduced is whatever those tests pin;
 * whether it holds is the CI run's verdict, not this comment's.
 *
 * FIFO invariant: connection completion and every emit are scheduled through the
 * one `defer` primitive, and the microtask queue is itself FIFO, so a socket
 * observes events in send order. The "did NOT receive" marker proofs in the
 * tests depend on this per-socket ordering; broadcast must preserve it.
 */

/**
 * Schedule `fn` for the next microtask. The single scheduling primitive shared
 * by connection completion (#40 decision 3-4b: connect resolves a tick later,
 * so a `socket.on('connect', ...)` handler is registered in time) and by emit
 * delivery (#41), which keeps connect and the first emits deterministically
 * ordered and every delivery asynchronous like real socket.io.
 */
export function defer(fn: () => void): void {
  queueMicrotask(fn);
}

/**
 * `Buffer.toString('base64url')` done by hand, over `btoa` and two character swaps.
 *
 * The padding strip is load-bearing despite looking like a no-op at the id's length.
 * `base64url` omits padding and `btoa` emits it, and the two agree only when the byte
 * length is a multiple of three, which 15 is. Drop the strip and ids stay correct until
 * the day someone changes the length, then quietly grow a `=`.
 *
 * Exported for `socket-id.test.ts`, which is the only caller that can pass a length
 * other than the id's and so the only place that claim can be pinned. Not re-exported
 * from `index.ts`, so it stays internal to the package.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * socket.io ids are 20-char url-safe base64. Match the shape, not the source (0011).
 *
 * The entropy comes from Web Crypto and the encoding is done by hand, because
 * `node:crypto` was the package's last host-specific import and it did not survive
 * the trip to a browser (#139): a bundler's `Buffer` shim has no `base64url`, so
 * `newId` threw and no client could connect anywhere but Node. `globalThis.crypto`
 * has been a global since Node 19, so nothing is given up on the Node side.
 */
export function newId(): string {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Build the connection handshake for a freshly paired socket (0006). `auth` is already
 * resolved to an object (see `resolveAuth`) and carried through unchanged: it travels as
 * a packet payload, so the server reads it exactly as resolved, with no stringifying. `query`
 * is stringified: on real socket.io it rides the connection url, so every value arrives
 * as a string, and smocket matches that (`{ room: 1 }` -> `{ room: '1' }`) so a dual-run
 * comparison holds. `url` is the origin the client connected to, and `time` / `issued`
 * are the moment the pairing completes, the two timestamps a mock can supply exactly.
 */
export function buildHandshake(
  url: string,
  auth: Record<string, unknown>,
  query?: Record<string, unknown>,
): Handshake {
  return {
    auth,
    query: stringifyValues(query ?? {}),
    url,
    time: new Date().toString(),
    issued: Date.now(),
  };
}

/**
 * Resolve the connection's auth to a plain object, then continue through `done`. An
 * object auth is handed straight over; a function auth is socket.io-client's callback
 * form, so it is invoked and the object it calls back with is the auth. The callback
 * may fire later than this tick (a token fetched async), which is exactly why the whole
 * pairing runs inside `done`: real socket.io holds the connection until the callback
 * fires, so a delayed callback delays the connect. A reconnect re-runs this resolve (the
 * reconnect path calls `pair` again), so the function is re-invoked for a fresh value.
 * Both behaviours pinned by measurement against the real client.
 */
export function resolveAuth(
  auth: ConnectOptions['auth'],
  done: (auth: Record<string, unknown>) => void,
): void {
  if (typeof auth === 'function') {
    auth((data) => done(data as Record<string, unknown>));
  } else {
    done(auth ?? {});
  }
}

/** Stringify every value of an object, the way a url querystring coerces them. */
function stringifyValues(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) out[key] = String(value);
  return out;
}

/** Normalize socket.io's `one room | many rooms` argument to an array. */
export function asRooms(room: string | string[]): string[] {
  return Array.isArray(room) ? room : [room];
}

/** One default-parser payload captured at its Socket.IO encode boundary (0026). */
export type EncodedPayload = { kind: 'json'; value: string } | { kind: 'binary'; value: unknown[] };

/**
 * Whether a value makes this a binary packet, which ADR 0026 deliberately excludes.
 * Keep those packets on the existing in-memory path rather than applying JSON rules
 * that Socket.IO's binary encoder does not use. The walk is cycle-safe so a non-binary
 * cycle still reaches JSON.stringify below and fails at the selected encode boundary.
 */
function containsBinary(value: unknown, seen = new Set<object>(), inspectToJSON = true): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  const toJSON = (value as { toJSON?: () => unknown }).toJSON;
  if (inspectToJSON && typeof toJSON === 'function') {
    return containsBinary(toJSON.call(value), seen, false);
  }
  if (seen.has(value)) return false;
  seen.add(value);
  for (const nested of Object.values(value)) {
    if (containsBinary(nested, seen)) return true;
  }
  return false;
}

/** Snapshot one argument list the way the default non-binary parser crosses JSON. */
export function encodePayload(args: unknown[]): EncodedPayload {
  if (containsBinary(args)) return { kind: 'binary', value: args };
  return { kind: 'json', value: JSON.stringify(args) };
}

/** Decode separately at each receiver, so broadcasts never share their object graph. */
function decodePayload(payload: EncodedPayload): unknown[] {
  return payload.kind === 'json' ? (JSON.parse(payload.value) as unknown[]) : payload.value;
}

/** Give every closed direct-connection call the same ordinary rejection shape. */
export function serverClosedError(): Error {
  return new Error('server is closed');
}

/**
 * Socket.IO's public-emit reserved names. The four lifecycle names are dispatched
 * locally by smocket and skipped by catch-alls; the final two belong to Node's emitter.
 * Application emit paths reject the whole set before observation or delivery.
 */
export const RESERVED_EVENTS = new Set([
  'connect',
  'connect_error',
  'disconnect',
  'disconnecting',
  'newListener',
  'removeListener',
]);

/** Reject names Socket.IO reserves for its own emitter and connection lifecycle. */
export function assertNotReservedEvent(event: string): void {
  if (RESERVED_EVENTS.has(event)) {
    throw new Error(`"${event}" is a reserved event name`);
  }
}

/**
 * A timeout races the next trailing acknowledgement against a real timer and retains
 * the socket's ordinary send path, so buffering, deferral, and payload handling stay intact.
 * The pending flag itself is consumed before this helper decorates the acknowledgement.
 *
 * The race settles exactly once. When the ack answers first, the timer is cleared and
 * the callback gets `(null, response)`, error-first with the collapsed first value. When
 * the timer fires first, the callback gets a lone `Error('operation has timed out')` and
 * `settled` then drops the late ack, so the callback never fires a second time. All three
 * shapes (the null-first success, the single-argument timeout error, the dropped late ack)
 * are pinned against real socket.io.
 */
export function withAckTimeout(
  args: unknown[],
  ms: number | undefined,
): { args: unknown[]; cancel?: (reason: Error) => void } {
  const last = args.at(-1);
  if (ms === undefined || typeof last !== 'function') return { args };

  const callback = last as (...received: unknown[]) => void;
  let settled = false;
  const timer = setTimeout(() => {
    settled = true;
    callback(new Error('operation has timed out'));
  }, ms);
  return {
    args: [
      ...args.slice(0, -1),
      (...answer: unknown[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(null, answer[0]);
      },
    ],
    cancel: (reason) => {
      settled = true;
      clearTimeout(timer);
      callback(reason);
    },
  };
}

/**
 * Deliver `event` to `target`'s listeners a tick later. A trailing function
 * argument is the ack: it is replaced with a wrapper the receiver calls to send
 * its answer back, and that answer is itself delivered a tick later, so the ack
 * round-trip is asynchronous in both directions like real socket.io. The
 * wrapper is one-shot: only the receiver's first ack reaches the sender, later
 * calls are dropped, matching real socket.io.
 */
export function send(target: DeliveryTarget, event: string, args: unknown[]): void {
  const last = args.at(-1);
  const ack = typeof last === 'function' ? (last as (...a: unknown[]) => void) : undefined;
  const data = ack ? args.slice(0, -1) : args;
  sendEncoded(target, event, encodePayload(data), ack);
}

/** Deliver one captured payload, decoding a fresh graph for this receiver. */
export function sendEncoded(
  target: DeliveryTarget,
  event: string,
  payload: EncodedPayload,
  ack?: (...answer: unknown[]) => void,
): void {
  let acked = false;
  const data = decodePayload(payload);
  const finalArgs = ack
    ? [
        ...data,
        (...answer: unknown[]) => {
          if (acked) return;
          // Ack responses cross the same boundary when the receiver invokes the
          // callback, not when the request was sent (0026).
          const response = encodePayload(answer);
          acked = true;
          defer(() => ack(...decodePayload(response)));
        },
      ]
    : data;
  target.scheduleReceive(() => target.dispatch(event, finalArgs));
}

/**
 * Route one delivery to `sid` through the adapter's optional scheduling hook (#78), or the
 * default next-tick when it has none. Keeping the choice here means a socket with no
 * delay behaves exactly as before, so the conformance suite is untouched.
 */
export function scheduleDelivery(adapter: SmocketAdapter, sid: string, deliver: () => void): void {
  if (adapter.scheduleDelivery) adapter.scheduleDelivery(sid, deliver);
  else defer(deliver);
}

/**
 * `emitWithAck` sugar over `send`'s trailing-callback ack: attach a callback
 * that resolves the promise with the peer's answer. The single-value resolve
 * shape is what the conformance suite pins against real socket.io.
 */
export function emitWithAck(
  target: DeliveryTarget | undefined,
  event: string,
  args: unknown[],
  beforeSend: () => void,
): Promise<unknown> {
  return new Promise((resolve) => {
    // The guard lives inside the executor to preserve Socket.IO's rejected-Promise
    // shape for emitWithAck, while ordinary emit throws synchronously.
    assertNotReservedEvent(event);
    if (!target) return;
    beforeSend();
    send(target, event, [...args, (...answer: unknown[]) => resolve(answer[0])]);
  });
}
