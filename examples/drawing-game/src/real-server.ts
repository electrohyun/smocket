import type { Server as HttpServer } from 'node:http';
import { Server as SocketIoServer } from 'socket.io';
import { registerDrawingGameApplication } from './game/application.js';
import type { ClientToServerEvents, GameServer, ServerToClientEvents } from './game/events.js';

/** Attach the real Socket.IO target to Vite's Node HTTP server. */
export function attachRealSocketIoServer(httpServer: HttpServer, countdownMs: number): () => void {
  const io = new SocketIoServer<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerDrawingGameApplication(io as unknown as GameServer, { countdownMs });
  return () => io.close();
}
