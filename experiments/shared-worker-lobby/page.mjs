import { SharedWorkerLobbyClient } from './client.mjs';

const search = new URLSearchParams(location.search);
const label = search.get('label');
const workerUrl = new URL('./shared-worker.mjs', import.meta.url);
const workerName = 'smocket-shared-worker-lobby-experiment';

if (search.has('anchor')) {
  const worker = new SharedWorker(workerUrl, { name: workerName, type: 'module' });
  worker.port.start();
  globalThis.lobbyAnchor = true;
} else {
  const client = new SharedWorkerLobbyClient({
    url: location.origin,
    label,
    workerUrl,
    workerName,
  });
  const events = [];
  const acknowledgementCalls = new Map();

  client.onAny((event, ...args) => {
    events.push({ event, args: args.filter((argument) => typeof argument !== 'function') });
  });
  client.on('server-ack-request', (token, acknowledge) => {
    acknowledge(`answer-from-${label}`);
    acknowledge(`duplicate-from-${label}`);
  });
  client.on('pending-server-ack', () => undefined);

  globalThis.lobby = {
    async waitForConnection() {
      await client.ready;
    },
    emit(event, ...args) {
      client.emit(event, ...args);
    },
    emitWithAck(key, event, ...args) {
      return new Promise((resolve) => {
        client.emit(event, ...args, (value) => {
          acknowledgementCalls.set(key, (acknowledgementCalls.get(key) ?? 0) + 1);
          resolve(value);
        });
      });
    },
    emitPending(key, event, ...args) {
      client.emit(event, ...args, () => {
        acknowledgementCalls.set(key, (acknowledgementCalls.get(key) ?? 0) + 1);
      });
    },
    disconnect() {
      return client.disconnect();
    },
    snapshot() {
      return {
        ...client.snapshot(),
        events: structuredClone(events),
        acknowledgementCalls: Object.fromEntries(acknowledgementCalls),
      };
    },
  };
}
