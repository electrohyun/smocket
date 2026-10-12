import { afterEach } from 'vitest';
import RealWebSocket, { WebSocketServer as RealWebSocketServer } from 'ws';
import type { AddressInfo } from '../../src/ws/contracts';
import * as mock from '../../src/ws/runtime';

export type Socket = Pick<RealWebSocket, 'on' | 'once' | 'send' | 'close' | 'readyState'> & {
  readonly url: string | undefined;
};
export type Server = Pick<RealWebSocketServer, 'on' | 'once' | 'close' | 'address'>;
type ManagedSocket = Socket & Pick<RealWebSocket, 'terminate'>;
interface BasicConstructors {
  WebSocket: new (url: string | URL) => ManagedSocket;
  WebSocketServer: new (
    options: { port: number; host?: string; path?: string },
    callback?: (this: { address(): AddressInfo | null }) => void,
  ) => Server;
}
// Projection is limited to methods exercised here, not the complete ws contract.
const constructors = (process.env.SMOCKET_TARGET === 'mock'
  ? mock
  : {
      WebSocket: RealWebSocket,
      WebSocketServer: RealWebSocketServer,
    }) as unknown as BasicConstructors;

/** Both targets exercise this subset; public constructor binding belongs to #562. */
export function setupWs() {
  const servers: Server[] = [];
  const sockets = new Set<ManagedSocket>();

  afterEach(async () => {
    for (const socket of sockets) {
      if (socket.readyState !== RealWebSocket.CLOSED) {
        socket.on('error', () => {});
        socket.terminate();
      }
    }
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  return {
    createServer(
      options: { port: number; host?: string; path?: string },
      callback?: (this: { address(): AddressInfo | null }) => void,
    ): Server {
      const server = new constructors.WebSocketServer(options, callback);
      servers.push(server);
      server.on('connection', (socket) => sockets.add(socket));
      return server;
    },
    createClient(url: string | URL): Socket {
      const socket = new constructors.WebSocket(url);
      sockets.add(socket);
      return socket;
    },
  };
}

export function listening(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('Expected an IP address'));
      resolve(address);
    });
  });
}

export function opened(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('open', resolve);
  });
}

export function closed(socket: Socket): Promise<{ code: number; reason: Buffer }> {
  return new Promise((resolve) =>
    socket.once('close', (code, reason) => resolve({ code, reason })),
  );
}
