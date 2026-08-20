import { afterEach, expect, it } from 'vitest';
import type { ClientSocketContract, ServerSocketContract } from './contract';
import { Server } from './mock-server';
import { receive } from './test-events';

const servers: Server[] = [];

function createServer(): Server {
  const server = new Server('http://localhost');
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

it('connect and nextConnection expose both sides of one admitted socket', async () => {
  const server = createServer();
  const namespace = server.of('/game');
  const fromListener = new Promise<ServerSocketContract>((resolve) => {
    namespace.on('connection', resolve);
  });
  const fromApi = server.nextConnection('game');

  const client = server.connect('/game', {
    auth: { token: 'native' },
    query: { source: 'direct' },
  });
  const [serverSocket, listenerSocket] = await Promise.all([fromApi, fromListener]);

  expect(listenerSocket).toBe(serverSocket);
  expect(client.id).toBe(serverSocket.id);
  expect(serverSocket.handshake.auth).toEqual({ token: 'native' });
  expect(serverSocket.handshake.query).toEqual({ source: 'direct' });
});

it('pairs wait-before-connect and connect-before-wait in connection order', async () => {
  const server = createServer();
  const firstConnection = server.nextConnection();
  const firstClient = server.connect();
  const secondClient = server.connect();

  const firstSocket = await firstConnection;
  const secondSocket = await server.nextConnection();

  expect(firstSocket.id).toBe(firstClient.id);
  expect(secondSocket.id).toBe(secondClient.id);
});

it('pairs connect-before-wait on a registered named namespace', async () => {
  const server = createServer();
  server.of('/game');
  const client = server.connect('/game');
  await receive(client, 'connect');

  const serverSocket = await server.nextConnection('game');

  expect(serverSocket.id).toBe(client.id);
  expect(serverSocket.nsp.name).toBe('/game');
});

it('pairs multiple waiting observers with clients in FIFO order', async () => {
  const server = createServer();
  const connections = [server.nextConnection(), server.nextConnection(), server.nextConnection()];
  const clients = [server.connect(), server.connect(), server.connect()];

  const sockets = await Promise.all(connections);

  expect(sockets.map((socket) => socket.id)).toEqual(clients.map((client) => client.id));
});

it('returns multiple ready sockets in FIFO order', async () => {
  const server = createServer();
  const clients = [server.connect(), server.connect(), server.connect()];
  await Promise.all(clients.map((client) => receive(client, 'connect')));

  const sockets = await Promise.all([
    server.nextConnection(),
    server.nextConnection(),
    server.nextConnection(),
  ]);

  expect(sockets.map((socket) => socket.id)).toEqual(clients.map((client) => client.id));
});

it('normalizes namespace names while keeping their queues isolated', async () => {
  const server = createServer();
  server.of('/game');
  const rootConnection = server.nextConnection('');
  const gameConnection = server.nextConnection('game');

  const gameClient = server.connect('/game');
  const rootClient = server.connect('/');
  const [rootSocket, gameSocket] = await Promise.all([rootConnection, gameConnection]);

  expect(rootSocket.id).toBe(rootClient.id);
  expect(rootSocket.nsp.name).toBe('/');
  expect(gameSocket.id).toBe(gameClient.id);
  expect(gameSocket.nsp.name).toBe('/game');
});

it('keeps direct connections in the established Manager groups', async () => {
  const server = createServer();
  server.of('/game');
  server.of('/forced');
  const rootConnection = server.nextConnection();
  const gameConnection = server.nextConnection('/game');
  const forcedConnection = server.nextConnection('/forced');

  const rootClient = server.connect();
  const gameClient = server.connect('/game');
  const forcedClient = server.connect('/forced', { forceNew: true });
  await Promise.all([rootConnection, gameConnection, forcedConnection]);

  expect(rootClient.io).toBe(gameClient.io);
  expect(forcedClient.io).not.toBe(rootClient.io);
});

it('skips rejected admission and resolves the waiter with the next accepted socket', async () => {
  const server = createServer();
  server.use((socket, next) => {
    next(socket.handshake.auth.allowed ? undefined : new Error('rejected'));
  });
  const connection = server.nextConnection();

  const rejectedClient = server.connect();
  await expect(receive(rejectedClient, 'connect_error')).resolves.toMatchObject({
    message: 'rejected',
  });

  const acceptedClient = server.connect('/', { auth: { allowed: true } });
  const serverSocket = await connection;

  expect(serverSocket.id).toBe(acceptedClient.id);
});

it('skips cancelled admission and resolves the waiter with the next accepted socket', async () => {
  const server = createServer();
  let release: (() => void) | undefined;
  const middlewareReached = new Promise<void>((resolve) => {
    server.use((socket, next) => {
      if (socket.handshake.auth.hold) {
        release = next;
        resolve();
        return;
      }
      next();
    });
  });
  const connection = server.nextConnection();

  const cancelledClient = server.connect('/', { auth: { hold: true } });
  await middlewareReached;
  cancelledClient.disconnect();
  release?.();

  const acceptedClient = server.connect();
  const serverSocket = await connection;

  expect(serverSocket.id).toBe(acceptedClient.id);
});

it('offers a repeatedly completed Socket to the direct API only once', async () => {
  const server = createServer();
  server.use((socket, next) => {
    next();
    if (socket.handshake.auth.repeated) {
      next();
      next();
    }
  });
  const firstConnection = server.nextConnection();
  const secondConnection = server.nextConnection();

  const repeatedClient = server.connect('/', { auth: { repeated: true } });
  const markerClient = server.connect('/', { forceNew: true });
  const [repeatedSocket, markerSocket] = await Promise.all([firstConnection, secondConnection]);

  expect(repeatedSocket.id).toBe(repeatedClient.id);
  expect(markerSocket.id).toBe(markerClient.id);
  expect(markerSocket).not.toBe(repeatedSocket);
});

it('does not leave a claimed Socket queued after a repeated middleware error', async () => {
  const server = createServer();
  server.use((socket, next) => {
    next();
    if (socket.handshake.auth.lateDenial) next(new Error('late denial'));
  });
  let markClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  server.on('connection', (socket) => {
    if (socket.handshake.auth.lateDenial) socket.once('disconnect', markClosed);
  });

  const firstConnection = server.nextConnection();
  const deniedClient = server.connect('/', { auth: { lateDenial: true } });
  const [deniedSocket] = await Promise.all([firstConnection, closed]);

  const nextConnection = server.nextConnection();
  const markerClient = server.connect('/', { forceNew: true });
  const markerSocket = await nextConnection;

  expect(deniedSocket.id).toBe(deniedClient.id);
  expect(markerSocket.id).toBe(markerClient.id);
  expect(markerSocket).not.toBe(deniedSocket);
});

it('close rejects pending static and dynamic namespace observers', async () => {
  const server = createServer();
  server.of('/game');
  server.of((_name, _auth, next) => next(null, true));
  const pending = [
    server.nextConnection(),
    server.nextConnection('/game'),
    server.nextConnection('/future'),
  ];
  const settled = Promise.allSettled(pending);

  await server.close();

  for (const result of await settled) {
    expect(result.status).toBe('rejected');
    expect((result as PromiseRejectedResult).reason).toEqual(new Error('server is closed'));
  }
});

it('close discards unclaimed sockets and rejects later observers', async () => {
  const server = createServer();
  const client: ClientSocketContract = server.connect();
  await receive(client, 'connect');

  await server.close();

  await expect(server.nextConnection()).rejects.toThrow('server is closed');
});

it('close preserves a ready socket claimed before teardown', async () => {
  const server = createServer();
  const client = server.connect();
  await receive(client, 'connect');
  const connectedId = client.id;
  const claimed = server.nextConnection();

  await server.close();

  const serverSocket = await claimed;
  expect(serverSocket.id).toBe(connectedId);
  expect(client.id).toBeUndefined();
  expect(serverSocket.rooms.size).toBe(0);
});
