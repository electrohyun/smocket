import { createServer, type Server as HttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Server as SocketIoServer } from 'socket.io';
import { registerDrawingGameHandlers, type ClientToServerEvents } from './application.js';
import { assertScenarioObservation } from './assertions.js';
import {
  runDrawingGameScenario,
  type ScenarioApplication,
  type ScenarioTarget,
} from './scenario.js';
import { createScenarioApplication } from './target.js';
import type { ServerToClientEvents } from './application.js';

function listen(httpServer: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
}

function closeSocketIo(
  io: SocketIoServer<ClientToServerEvents, ServerToClientEvents>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    io.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// [snippet:start real-bootstrap]
export async function startRealApplication(): Promise<ScenarioApplication> {
  const httpServer = createServer();
  const io = new SocketIoServer<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerDrawingGameHandlers(io);
  await listen(httpServer);

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    await closeSocketIo(io);
    throw new Error('Socket.IO did not receive a TCP address');
  }

  return createScenarioApplication(io, `http://127.0.0.1:${address.port}`, () => closeSocketIo(io));
}
// [snippet:end real-bootstrap]

export const realTarget: ScenarioTarget = {
  id: 'socket.io',
  start: startRealApplication,
};

export async function observeRealTarget() {
  return assertScenarioObservation(await runDrawingGameScenario(realTarget));
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  console.log(JSON.stringify(await observeRealTarget(), null, 2));
}
