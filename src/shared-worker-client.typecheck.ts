import {
  connectSharedWorker,
  type SharedWorkerSocket,
  type SharedWorkerSocketReservedEvents,
} from './shared-worker';

interface ServerToClientEvents {
  update: (value: string) => void;
  question: (value: string, acknowledge: (answer: number) => void) => void;
}

interface ClientToServerEvents {
  change: (value: number) => void;
  ask: (value: string, acknowledge: (accepted: boolean) => void) => void;
  message: (...args: unknown[]) => void;
}

declare const port: MessagePort;

const socket: SharedWorkerSocket<ServerToClientEvents, ClientToServerEvents> = connectSharedWorker<
  ServerToClientEvents,
  ClientToServerEvents
>(port, {
  url: 'https://example.test/lobby',
  auth: { label: 'A' },
});

socket
  .on('connect', () => undefined)
  .on('connect_error', (error) => error.message)
  .on('disconnect', (reason) => reason.toUpperCase())
  .on('bridge_error', (error) => error.message)
  .on('update', (value) => value.toUpperCase())
  .on('question', (_value, acknowledge) => acknowledge(42));

socket.emit('change', 1);
socket.emit('ask', 'ready?', (accepted) => accepted.valueOf());
socket.send('permissive', 1);
const accepted: Promise<boolean> = socket.emitWithAck('ask', 'ready?');
void accepted;

socket.auth = { label: 'B' };
socket.connect().open().disconnect().close();
socket
  .onAny((_event, ..._args) => undefined)
  .offAny()
  .listenersAny();
socket.removeAllListeners('update').listeners('update');
const updateListeners: Array<(value: string) => void> = socket.listeners('update');
void updateListeners;

const lifecycle: keyof SharedWorkerSocketReservedEvents = 'bridge_error';
void lifecycle;

// @ts-expect-error the narrow facade has no Manager
void socket.io;
// @ts-expect-error acknowledgement timeouts are intentionally unsupported
socket.timeout(100);
// @ts-expect-error volatile delivery is intentionally unsupported
void socket.volatile;
// @ts-expect-error compression is a transport concern
socket.compress(false);
// @ts-expect-error outgoing catch-alls are intentionally unsupported
socket.onAnyOutgoing(() => undefined);
// @ts-expect-error recovery is intentionally unsupported
void socket.recovered;
// @ts-expect-error auth callbacks cannot cross the worker boundary
socket.auth = (_callback: (auth: Record<string, unknown>) => void) => undefined;
// @ts-expect-error typed outgoing payloads keep their declared argument type
socket.emit('change', 'wrong');
// @ts-expect-error typed incoming event names are checked
socket.on('missing', () => undefined);
