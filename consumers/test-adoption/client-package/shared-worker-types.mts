import { Server } from 'smocket';
import { attachSharedWorker } from 'smocket/shared-worker';
import { connectSharedWorker, type SharedWorkerSocket } from 'smocket-client/shared-worker';

interface ServerToClientEvents {
  ready: (room: string) => void;
}

interface ClientToServerEvents {
  join: (room: string) => void;
}

declare const port: MessagePort;
const workerServer = new Server('http://shared-worker-types.test');
const workerHost = attachSharedWorker(workerServer, port);
const workerSocket: SharedWorkerSocket<ServerToClientEvents, ClientToServerEvents> =
  connectSharedWorker<ServerToClientEvents, ClientToServerEvents>(port, {
    url: 'http://shared-worker-types.test',
    auth: { userId: 'worker' },
  });
workerSocket.on('ready', (room) => room.toUpperCase());
workerSocket.emit('join', 'general');
workerHost.close();

// @ts-expect-error The narrow SharedWorker facade does not expose a Manager.
void workerSocket.io;
