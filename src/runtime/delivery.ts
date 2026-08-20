import type { ConnectOptions, Handshake, SmocketAdapter } from '../contract';

export interface DeliveryTarget {
  scheduleReceive(deliver: () => void): void;
  dispatch(event: string, args: unknown[]): void;
  acknowledgementGuard(): () => boolean;
}

/** The shared microtask primitive keeps connection and delivery asynchronous and FIFO (0004, 0010). */
export function defer(fn: () => void): void {
  queueMicrotask(fn);
}

/**
 * Browser-safe base64url encoding. Padding removal matters for lengths other than the
 * current 15-byte id and is pinned through this internal test export.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Match Socket.IO's 20-character id shape, not its source (0011). Web Crypto and
 * browser-safe encoding avoid the `node:crypto` bundling failure tracked in #139.
 */
export function newId(): string {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Build only handshake fields the mock can source (0006). Auth remains a packet payload;
 * query values stringify as URL data does, while timestamps describe this pairing.
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
 * Callback auth may resolve later and is re-evaluated on reconnect; both behaviors were
 * measured against the real client, so pairing continues only through `done`.
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

function stringifyValues(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) out[key] = String(value);
  return out;
}

export function asRooms(room: string | string[]): string[] {
  return Array.isArray(room) ? room : [room];
}

/** One default-parser payload captured at its Socket.IO encode boundary (0026). */
export type EncodedPayload = { kind: 'json'; value: string } | { kind: 'binary'; value: unknown[] };

/**
 * Keep binary packets outside ADR 0026's JSON rules. Cycle-safe detection still lets a
 * non-binary cycle fail at the selected JSON encode boundary.
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

export function encodePayload(args: unknown[]): EncodedPayload {
  if (containsBinary(args)) return { kind: 'binary', value: args };
  return { kind: 'json', value: JSON.stringify(args) };
}

function decodePayload(payload: EncodedPayload): unknown[] {
  return payload.kind === 'json' ? (JSON.parse(payload.value) as unknown[]) : payload.value;
}

export function serverClosedError(): Error {
  return new Error('server is closed');
}

/** Lifecycle names dispatch locally; Node meta-events and lifecycle names are never public emits. */
export const RESERVED_EVENTS = new Set([
  'connect',
  'connect_error',
  'disconnect',
  'disconnecting',
  'newListener',
  'removeListener',
]);

export function assertNotReservedEvent(event: string): void {
  if (RESERVED_EVENTS.has(event)) {
    throw new Error(`"${event}" is a reserved event name`);
  }
}

/**
 * Race the next acknowledgement against a timer without bypassing the ordinary send path.
 * The measured result is single-shot: `(null, response)` on success, one Error on timeout,
 * and no second callback for a late answer.
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
 * Deliver asynchronously. A trailing ack also returns asynchronously and is one-shot,
 * matching the measured Socket.IO round trip.
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
  let dispatching = false;
  const data = decodePayload(payload);
  let finalArgs = data;
  if (ack) {
    const acknowledgementActive = target.acknowledgementGuard();
    finalArgs = [
      ...data,
      (...answer: unknown[]) => {
        // Teardown may drain an already-queued delivery (0018); its listener may
        // still answer synchronously, but a callback retained beyond dispatch
        // belongs to the connection generation that has now ended (0012).
        if (acked || (!dispatching && !acknowledgementActive())) return;
        // Ack responses cross the same boundary when the receiver invokes the
        // callback, not when the request was sent (0026).
        const response = encodePayload(answer);
        acked = true;
        defer(() => ack(...decodePayload(response)));
      },
    ];
  }
  target.scheduleReceive(() => {
    dispatching = true;
    try {
      target.dispatch(event, finalArgs);
    } finally {
      dispatching = false;
    }
  });
}

/** Use the adapter's scheduling hook (#78), falling back to the shared next tick. */
export function scheduleDelivery(adapter: SmocketAdapter, sid: string, deliver: () => void): void {
  if (adapter.scheduleDelivery) adapter.scheduleDelivery(sid, deliver);
  else defer(deliver);
}

/** Promise acknowledgement resolves with the peer's first answer value, as Socket.IO does. */
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
