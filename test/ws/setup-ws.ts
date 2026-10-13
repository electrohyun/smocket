import { afterEach } from 'vitest';
import RealWebSocket, { WebSocketServer as RealWebSocketServer } from 'ws';
import type { AddressInfo, RequestHeaders } from '../../src/ws/contracts';
import * as mock from '../../src/ws/runtime';

export type Listener = (...args: unknown[]) => void;
export type RawListener = Listener & { listener?: Listener };
export interface CustomEmitter {
  on(event: string | symbol, listener: Listener): this;
  once(event: string | symbol, listener: Listener): this;
  addListener(event: string | symbol, listener: Listener): this;
  removeListener(event: string | symbol, listener: Listener): this;
  off(event: string | symbol, listener: Listener): this;
  removeAllListeners(event?: string | symbol): this;
  emit(event: string | symbol, ...args: unknown[]): boolean;
  listeners(event: string | symbol): Listener[];
  rawListeners(event: string | symbol): RawListener[];
  listenerCount(event: string | symbol, listener?: Listener): number;
  eventNames(): (string | symbol)[];
}
interface Emitter<Events extends { [Event in keyof Events]: unknown[] }> extends CustomEmitter {
  on<Event extends keyof Events>(event: Event, listener: (...args: Events[Event]) => void): this;
  on(event: string | symbol, listener: Listener): this;
  once<Event extends keyof Events>(event: Event, listener: (...args: Events[Event]) => void): this;
  once(event: string | symbol, listener: Listener): this;
}
interface SocketEvents {
  open: [];
  message: [data: Buffer, isBinary: boolean];
  close: [code: number, reason: Buffer];
  error: [error: Error];
}
export interface Socket extends Emitter<SocketEvents> {
  readonly readyState: number;
  readonly url: string | undefined;
  send(text: string): void;
  close(code?: number, reason?: string | Buffer): void;
  terminate(): void;
}
interface ServerEvents {
  connection: [socket: Socket, request: { url?: string; method?: string; headers: RequestHeaders }];
  listening: [];
  close: [];
  error: [error: Error];
}
export interface Server extends Emitter<ServerEvents> {
  address(): AddressInfo | string | null;
  close(callback?: (error?: Error) => void): void;
}
interface BasicConstructors {
  WebSocket: new (url: string | URL) => Socket;
  WebSocketServer: new (
    options: { port: number; host?: string; path?: string },
    callback?: (this: { address(): AddressInfo | null }) => void,
  ) => Server;
}
// Both implementations must structurally satisfy the exercised subset, without a cast.
const constructors: BasicConstructors =
  process.env.SMOCKET_TARGET === 'mock'
    ? mock
    : {
        WebSocket: RealWebSocket,
        WebSocketServer: RealWebSocketServer,
      };

/** Both targets exercise this subset; public constructor binding belongs to #562. */
export function setupWs() {
  const servers: Server[] = [];
  const sockets = new Set<Socket>();

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
    servers.length = 0;
    sockets.clear();
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
