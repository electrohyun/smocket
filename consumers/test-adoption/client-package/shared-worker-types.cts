import sharedWorkerClient = require('smocket-client/shared-worker');
import smocket = require('smocket');
import sharedWorkerHost = require('smocket/shared-worker');

interface ServerToClientEvents {
  ready: (room: string) => void;
}

interface ClientToServerEvents {
  join: (room: string) => void;
}

declare const port: MessagePort;
const workerServer = new smocket.Server('http://shared-worker-types.test');
const workerHost = sharedWorkerHost.attachSharedWorker(workerServer, port);
const workerSocket: sharedWorkerClient.SharedWorkerSocket<
  ServerToClientEvents,
  ClientToServerEvents
> = sharedWorkerClient.connectSharedWorker<ServerToClientEvents, ClientToServerEvents>(port, {
  url: 'http://shared-worker-types.test',
  auth: { userId: 'worker' },
});
workerSocket.on('ready', (room) => room.toUpperCase());
workerSocket.emit('join', 'general');
workerHost.close();

// @ts-expect-error The raw bridge protocol is internal to the narrow facade (ADR 0038).
void sharedWorkerHost.SHARED_WORKER_PROTOCOL_VERSION;

// @ts-expect-error The narrow SharedWorker facade does not expose a Manager.
void workerSocket.io;
