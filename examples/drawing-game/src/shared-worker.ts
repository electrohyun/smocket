/// <reference lib="webworker" />

import { Server } from 'smocket';
import { attachSharedWorker } from 'smocket/shared-worker';
import { registerDrawingGameApplication } from './game/application.js';
import {
  GAME_URL,
  type ClientToServerEvents,
  type GameServer,
  type ServerToClientEvents,
} from './game/events.js';

const io = new Server<ClientToServerEvents, ServerToClientEvents>(GAME_URL);
registerDrawingGameApplication(io as unknown as GameServer, {
  countdownMs: __DRAWING_GAME_COUNTDOWN_MS__,
});

const workerScope = globalThis as unknown as SharedWorkerGlobalScope;
workerScope.onconnect = (event) => {
  const port = event.ports[0];
  if (port) attachSharedWorker(io, port);
};
