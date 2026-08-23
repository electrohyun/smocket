import type { GameClient, Label } from '../game/events.js';
import { connectToSharedWorker } from './shared-worker-client.js';
import { connectToSocketIo } from './socket-io-client.js';

export type GameTarget = 'smocket' | 'real';

export const GAME_TARGET: GameTarget = __DRAWING_GAME_TARGET__;
const WORKER_VERSION_KEY = 'drawing-game-worker-version';

function workerVersion(): string {
  return (
    localStorage.getItem(WORKER_VERSION_KEY) ??
    new URLSearchParams(location.search).get('workerVersion') ??
    '0'
  );
}

function reloadWithWorkerVersion(version: string): void {
  const url = new URL(location.href);
  if (url.searchParams.get('workerVersion') === version) return;
  url.searchParams.set('workerVersion', version);
  location.replace(url);
}

export function connectPage(label: Label, presenceId: string): GameClient {
  return GAME_TARGET === 'real'
    ? connectToSocketIo(label, presenceId)
    : connectToSharedWorker(label, presenceId, workerVersion());
}

if (import.meta.hot) {
  import.meta.hot.on('drawing-game:handler-changed', ({ version }: { version: string }) => {
    localStorage.setItem(WORKER_VERSION_KEY, version);
    reloadWithWorkerVersion(version);
  });
  window.addEventListener('storage', (event) => {
    if (event.key === WORKER_VERSION_KEY && event.newValue) {
      reloadWithWorkerVersion(event.newValue);
    }
  });
}
