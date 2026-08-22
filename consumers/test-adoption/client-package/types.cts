import client = require('smocket-client');
import sharedWorkerClient = require('smocket-client/shared-worker');
import smocket = require('smocket');
import sharedWorkerHost = require('smocket/shared-worker');

interface ServerToClientEvents {
  ready: (room: string) => void;
}

interface ClientToServerEvents {
  join: (room: string) => void;
}

const options: client.SocketOptions = { auth: { userId: 'cjs' } };
const socket: client.Socket<ServerToClientEvents, ClientToServerEvents> = client<
  ServerToClientEvents,
  ClientToServerEvents
>('http://localhost:3277', options);

socket.on('ready', (room) => room.toUpperCase());
socket.emit('join', 'general');

const sameLookup: typeof client = client.io;
const sameConnect: typeof client = client.connect;
void sameLookup;
void sameConnect;

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

// @ts-expect-error The CommonJS root is callable but still requires a URL.
client();
// @ts-expect-error The namespace comes from the URL path.
client('http://localhost:3277', { namespace: '/hidden' });
// @ts-expect-error Retry behavior is outside the supported client surface.
const retryOptions: client.SocketOptions = { retries: 2 };
void retryOptions;
// @ts-expect-error Clients listen to the server-to-client event map.
socket.on('join', () => undefined);
// @ts-expect-error Clients emit through the client-to-server event map.
socket.emit('ready', 'general');
// @ts-expect-error The narrow SharedWorker facade does not expose a Manager.
void workerSocket.io;
