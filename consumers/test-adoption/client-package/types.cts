import client = require('smocket-client');

interface ServerToClientEvents {
  ready: (room: string) => void;
}

interface ClientToServerEvents {
  join: (room: string) => void;
}

const options: client.SocketOptions = { auth: { userId: 'cjs' } };
const socket: client.Socket<ServerToClientEvents, ClientToServerEvents> = client(
  'http://localhost:3277',
  options,
);

socket.on('ready', (room) => room.toUpperCase());
socket.emit('join', 'general');

const sameLookup: typeof client = client.io;
const sameConnect: typeof client = client.connect;
void sameLookup;
void sameConnect;

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
