import { expect, it } from 'vitest';
import {
  connect,
  io,
  Server,
  type AdapterContract,
  type BroadcastContract,
  type ClientSocketContract,
  type ConnectionMiddleware,
  type Handshake,
  type MiddlewareError,
  type NamespaceContract,
  type ServerContract,
  type ServerSocketContract,
  type SocketTimeoutContract,
  type TimeoutBroadcastContract,
  type TimeoutEmitterContract,
  type VolatileClientSocket,
  type VolatileServerSocket,
} from './index';

it('connecting pairs the client and server socket with the same id', async () => {
  const server = new Server('http://localhost');
  const client = server.connect();
  const serverSocket = await server.nextConnection();

  expect(client.connected).toBe(true);
  expect(client.id).toBeTruthy();
  expect(serverSocket.id).toBe(client.id);
});

it("exports `io` as socket.io-client's name for connect, so a module swap works", async () => {
  // The substitution path: app code written as `import { io } from 'socket.io-client'`
  // runs unchanged once the module resolves to smocket.
  expect(io).toBe(connect);

  const server = new Server('http://localhost');
  const client = io('http://localhost');
  const serverSocket = await server.nextConnection();

  expect(client.id).toBe(serverSocket.id);
});

it('exports the contract types, so the swap keeps an app annotations to use', async () => {
  // The other half of the substitution path: the value side above resolves, but an app
  // that wrote `import { io, type Socket } from 'socket.io-client'` also needs a name to
  // annotate with. Every annotation below is the assertion, since a missing export stops
  // `pnpm typecheck` compiling; the runtime checks only keep the bindings live.
  const server = new Server('http://localhost');
  const asContract: ServerContract = server;
  const client: ClientSocketContract = io('http://localhost');
  const serverSocket: ServerSocketContract = await server.nextConnection();

  const nsp: NamespaceContract = serverSocket.nsp;
  const adapter: AdapterContract = nsp.adapter;
  const handshake: Handshake = serverSocket.handshake;

  // The types reachable from those entry points are nameable too, rather than only
  // present in the emitted declarations.
  const room: BroadcastContract = asContract.to(serverSocket.id);
  const timedRoom: TimeoutBroadcastContract = room.timeout(50);
  const socketTimeout: SocketTimeoutContract = serverSocket.timeout(50);
  const clientTimeout: TimeoutEmitterContract = client.timeout(50);
  const volatileServer: VolatileServerSocket = serverSocket.volatile;
  const volatileClient: VolatileClientSocket = client.volatile;
  const middleware: ConnectionMiddleware = (socket, next) => {
    const rejection: MiddlewareError = Object.assign(new Error('rejected'), { data: socket.id });
    next(rejection);
  };

  expect(client.id).toBe(serverSocket.id);
  expect(nsp.name).toBe('/');
  expect(adapter.rooms.get(serverSocket.id)).toEqual(new Set([serverSocket.id]));
  expect(handshake.url).toBeTypeOf('string');
  expect(middleware).toBeTypeOf('function');
  expect([
    room,
    timedRoom,
    socketTimeout,
    clientTimeout,
    volatileServer,
    volatileClient,
  ]).not.toContain(undefined);
});
