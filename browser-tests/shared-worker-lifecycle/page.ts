import { connectSharedWorker } from '../../src/shared-worker-client';

type EventArguments = unknown[];

interface EventWaiter {
  readonly event: string;
  readonly expected?: unknown;
  readonly resolve: (args: EventArguments) => void;
}

export interface SharedWorkerLifecycleProbe {
  readonly connected: Promise<void>;
  emit(event: string, ...args: unknown[]): void;
  emitPending(event: string, ...args: unknown[]): void;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  events(event: string): EventArguments[];
  waitFor(event: string, expected?: unknown): Promise<EventArguments>;
  disconnect(): void;
}

declare global {
  interface Window {
    sharedWorkerLifecycleProbe: SharedWorkerLifecycleProbe;
  }
}

const parameters = new URLSearchParams(location.search);
const label = parameters.get('label') ?? 'A';
const version = parameters.get('version') ?? 'v1';
const worker = new SharedWorker(new URL('./worker.js', location.href), {
  name: `smocket-lifecycle-${version}`,
  type: 'module',
});
const socket = connectSharedWorker(worker.port, {
  url: 'http://shared-worker-lifecycle.test',
  auth: { label },
});
const observed = new Map<string, EventArguments[]>();
const waiters: EventWaiter[] = [];

function matches(args: EventArguments, expected: unknown): boolean {
  if (expected === undefined) return true;
  const first = args[0];
  if (first === expected) return true;
  return typeof first === 'object' && first !== null && 'label' in first
    ? (first as { label?: unknown }).label === expected
    : false;
}

function record(event: string, args: EventArguments): void {
  const serializableArgs = args.filter((argument) => typeof argument !== 'function');
  const entries = observed.get(event) ?? [];
  entries.push(serializableArgs);
  observed.set(event, entries);
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    const waiter = waiters[index];
    if (!waiter || waiter.event !== event || !matches(serializableArgs, waiter.expected)) continue;
    waiters.splice(index, 1);
    waiter.resolve(serializableArgs);
  }
}

const connected = new Promise<void>((resolve) => socket.once('connect', resolve));
socket.onAny((event, ...args) => record(event, args));
socket.on('disconnect', (reason) => record('disconnect', [reason]));
socket.on('bridge_error', (error) => record('bridge_error', [error.message]));
socket.on('server-pending', () => undefined);

window.sharedWorkerLifecycleProbe = {
  connected,
  emit(event, ...args) {
    socket.emit(event, ...args);
  },
  emitPending(event, ...args) {
    socket.emit(event, ...args, () => undefined);
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
  disconnect() {
    socket.disconnect();
  },
};
