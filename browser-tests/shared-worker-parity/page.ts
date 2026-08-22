import { io as connectSocketIo } from 'socket.io-client';
import { connectSharedWorker } from '../../src/shared-worker-client';

type EventArguments = unknown[];
type Listener = (...args: unknown[]) => void;

interface PageSocket {
  readonly id?: string;
  readonly connected: boolean;
  on(event: string, listener: Listener): PageSocket;
  once(event: string, listener: Listener): PageSocket;
  onAny(listener: (event: string, ...args: unknown[]) => void): PageSocket;
  emit(event: string, ...args: unknown[]): PageSocket;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  disconnect(): PageSocket;
}

interface EventWaiter {
  readonly event: string;
  readonly expected?: unknown;
  readonly resolve: (args: EventArguments) => void;
}

interface ParityProbe {
  readonly connected: Promise<void>;
  emit(event: string, ...args: unknown[]): void;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  events(event: string): EventArguments[];
  waitFor(event: string, expected?: unknown): Promise<EventArguments>;
  snapshot(): { id: string | undefined; connected: boolean };
  disconnect(): void;
}

declare global {
  var sharedWorkerParityProbe: ParityProbe;
}

const parameters = new URLSearchParams(location.search);
const label = parameters.get('label') ?? 'A';
const target = parameters.get('target') ?? 'shared-worker';
const sidecarUrl = parameters.get('sidecar');
let socket: PageSocket;

if (target === 'real') {
  if (!sidecarUrl) throw new Error('The real parity target requires a sidecar URL');
  socket = connectSocketIo(sidecarUrl, { auth: { label } }) as unknown as PageSocket;
} else {
  const worker = new SharedWorker(new URL('./worker.js', location.href), {
    name: 'smocket-shared-worker-parity-v1',
    type: 'module',
  });
  socket = connectSharedWorker(worker.port, {
    url: 'http://shared-worker-parity.test',
    auth: { label },
  });
}

const observed = new Map<string, EventArguments[]>();
const waiters: EventWaiter[] = [];

function serializable(args: EventArguments): EventArguments {
  return args.filter((value) => typeof value !== 'function');
}

function matches(args: EventArguments, expected: unknown): boolean {
  if (expected === undefined) return true;
  const first = args[0];
  if (first === expected) return true;
  return typeof first === 'object' && first !== null && 'label' in first
    ? (first as { label?: unknown }).label === expected
    : false;
}

function record(event: string, incomingArgs: EventArguments): void {
  const args = serializable(incomingArgs);
  const entries = observed.get(event) ?? [];
  entries.push(args);
  observed.set(event, entries);
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    const waiter = waiters[index];
    if (!waiter || waiter.event !== event || !matches(args, waiter.expected)) continue;
    waiters.splice(index, 1);
    waiter.resolve(args);
  }
}

const connected = socket.connected
  ? Promise.resolve()
  : new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error) =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
    });

socket.onAny((event, ...args) => record(event, args));
socket.on('disconnect', (reason) => record('disconnect', [reason]));
socket.on('server-ack-request', (token, acknowledge) => {
  const reply = acknowledge as (answer: string) => void;
  reply(`answer-from-${label}`);
  reply('duplicate');
  record('server-ack-handled', [token]);
});

globalThis.sharedWorkerParityProbe = {
  connected,
  emit(event, ...args) {
    socket.emit(event, ...args);
  },
  emitWithAck(event, ...args) {
    return socket.emitWithAck(event, ...args);
  },
  events(event) {
    return observed.get(event) ?? [];
  },
  waitFor(event, expected) {
    const existing = observed.get(event)?.find((args) => matches(args, expected));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => waiters.push({ event, expected, resolve }));
  },
  snapshot() {
    return { id: socket.id, connected: socket.connected };
  },
  disconnect() {
    socket.disconnect();
  },
};
