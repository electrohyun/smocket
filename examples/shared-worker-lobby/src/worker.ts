import { Server } from 'smocket';
import { attachSharedWorker } from 'smocket/shared-worker';
import {
  LOBBY_URL,
  registerLobbyHandlers,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from './application';

const io = new Server<ClientToServerEvents, ServerToClientEvents>(LOBBY_URL);
registerLobbyHandlers(io);

const workerScope = globalThis as unknown as SharedWorkerGlobalScope;
workerScope.onconnect = (event) => {
  const port = event.ports[0];
  if (port) attachSharedWorker(io, port);
};
