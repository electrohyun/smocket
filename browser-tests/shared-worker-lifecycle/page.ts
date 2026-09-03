import { connectSharedWorker } from '../../src/shared-worker-client';

type EventArguments = unknown[];

interface EventWaiter {
  readonly event: string;
  readonly expected?: unknown;
  readonly resolve: (args: EventArguments) => void;
}

export interface SharedWorkerLifecycleProbe {
  readonly connected: Promise<void>;
  state(): {
    readonly instanceId: string;
    readonly connected: boolean;
    readonly socketId: string | undefined;
    readonly pagehidePersisted: boolean[];
    readonly pageshowPersisted: boolean[];
    readonly navigationType: string | undefined;
    readonly notRestoredReasons: string[];
  };
  emit(event: string, ...args: unknown[]): void;
  emitPending(event: string, ...args: unknown[]): void;
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown>;
  events(event: string): EventArguments[];
  waitFor(event: string, expected?: unknown): Promise<EventArguments>;
  connect(): void;
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
const lifecycleStorageKey = `smocket-lifecycle-pagehide-${label}-${version}`;
const navigation = performance.getEntriesByType('navigation')[0] as
  | (PerformanceNavigationTiming & {
      readonly notRestoredReasons?: {
        readonly reasons?: ReadonlyArray<{ readonly reason?: string }>;
        readonly children?: ReadonlyArray<unknown>;
      } | null;
    })
  | undefined;
if (navigation?.type !== 'back_forward') sessionStorage.removeItem(lifecycleStorageKey);
const pagehidePersisted = JSON.parse(
  sessionStorage.getItem(lifecycleStorageKey) ?? '[]',
) as boolean[];
const pageshowPersisted: boolean[] = [];
const instanceId = crypto.randomUUID();

window.addEventListener('pagehide', (event) => {
  pagehidePersisted.push(event.persisted);
  sessionStorage.setItem(lifecycleStorageKey, JSON.stringify(pagehidePersisted));
});
window.addEventListener('pageshow', (event) => pageshowPersisted.push(event.persisted));

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

function collectNotRestoredReasons(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as {
    readonly reasons?: ReadonlyArray<{ readonly reason?: string }>;
    readonly children?: ReadonlyArray<unknown>;
  };
  return [
    ...(record.reasons ?? []).flatMap(({ reason }) => (reason ? [reason] : [])),
    ...(record.children ?? []).flatMap(collectNotRestoredReasons),
  ];
}

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
  state() {
    return {
      instanceId,
      connected: socket.connected,
      socketId: socket.id,
      pagehidePersisted: [...pagehidePersisted],
      pageshowPersisted: [...pageshowPersisted],
      navigationType: navigation?.type,
      notRestoredReasons: collectNotRestoredReasons(navigation?.notRestoredReasons),
    };
  },
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
  connect() {
    socket.connect();
  },
  disconnect() {
    socket.disconnect();
  },
};
