import client, { connect, io, type Socket, type SocketOptions } from 'smocket-client';
import { Server } from 'smocket';
import { attachSharedWorker } from 'smocket/shared-worker';
import { connectSharedWorker, type SharedWorkerSocket } from 'smocket-client/shared-worker';

interface ServerToClientEvents {
  ready: (room: string) => void;
}

interface ClientToServerEvents {
  join: (room: string) => void;
}

const options: SocketOptions = { auth: { userId: 'esm' } };
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io<
  ServerToClientEvents,
  ClientToServerEvents
>('http://localhost:3276', {
  ...options,
  query: { source: 'types' },
  forceNew: true,
  multiplex: false,
});

socket.on('ready', (room) => room.toUpperCase());
socket.emit('join', 'general');

const sameLookup: typeof io = client;
const sameConnect: typeof io = connect;
void sameLookup;
void sameConnect;

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

// @ts-expect-error The facade keeps smocket's required URL.
io();
// @ts-expect-error The namespace comes from the URL path.
io('http://localhost:3276', { namespace: '/hidden' });
// @ts-expect-error Retry behavior is outside the supported client surface.
const retryOptions: SocketOptions = { retries: 2 };
void retryOptions;
// @ts-expect-error Clients listen to the server-to-client event map.
socket.on('join', () => undefined);
// @ts-expect-error Clients emit through the client-to-server event map.
socket.emit('ready', 'general');
// @ts-expect-error The narrow SharedWorker facade does not expose a Manager.
void workerSocket.io;
