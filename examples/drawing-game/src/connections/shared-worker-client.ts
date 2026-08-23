import { connectSharedWorker } from 'smocket-client/shared-worker';
import type { SharedWorkerSocket } from 'smocket/shared-worker';
import {
  GAME_URL,
  type ClientToServerEvents,
  type GameClient,
  type Label,
  type ServerToClientEvents,
} from '../game/events.js';

export const DRAWING_WORKER_NAME = 'smocket-drawing-game-v1';

export function connectToSharedWorker(
  label: Label,
  presenceId: string,
  workerVersion: string,
): GameClient {
  if (typeof SharedWorker !== 'function') {
    throw new Error('This example requires SharedWorker support in a desktop Chromium browser.');
  }
  const worker = new SharedWorker(new URL('../shared-worker.ts', import.meta.url), {
    name: `${DRAWING_WORKER_NAME}-${workerVersion}`,
    type: 'module',
  });
  return connectSharedWorker<ServerToClientEvents, ClientToServerEvents>(worker.port, {
    url: GAME_URL,
    auth: { label, presenceId },
  }) as SharedWorkerSocket<ServerToClientEvents, ClientToServerEvents> as unknown as GameClient;
}
