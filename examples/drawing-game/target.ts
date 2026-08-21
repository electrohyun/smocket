import type { DrawingGameServer, Label } from './application.js';
import { SCENARIO_MARKER, type ScenarioApplication } from './scenario.js';

const BARRIER_EVENT = 'drawing-game:barrier';

interface HarnessSocket {
  handshake: { auth: Record<string, unknown> };
  on(event: string, listener: (token: string) => void): void;
  once(event: 'disconnect', listener: () => void): void;
}

interface HarnessServer {
  on(event: 'connection', listener: (socket: HarnessSocket) => void): void;
  emit(event: string, token: string): void;
}

interface BarrierClient {
  emit(event: string, token: string): void;
}

/** Target-only lifecycle and marker control; no application handler depends on it. */
export function createScenarioApplication(
  io: DrawingGameServer,
  url: string,
  close: () => Promise<void>,
): ScenarioApplication {
  const disconnected = new Map<Label, Promise<void>>();
  // Barrier and marker are deliberately absent from the public application maps.
  const harnessServer = io as unknown as HarnessServer;
  let closePromise: Promise<void> | undefined;

  harnessServer.on('connection', (socket) => {
    const label = socket.handshake.auth.label;
    if (label !== 'A' && label !== 'B' && label !== 'C') return;
    disconnected.set(label, new Promise((resolve) => socket.once('disconnect', () => resolve())));
    socket.on(BARRIER_EVENT, (token) => harnessServer.emit(SCENARIO_MARKER, token));
  });

  return {
    url,
    barrier(client, token) {
      (client as unknown as BarrierClient).emit(BARRIER_EVENT, token);
    },
    waitForDisconnect(label) {
      const pending = disconnected.get(label);
      if (!pending) throw new Error(`No server connection was recorded for ${label}`);
      return pending;
    },
    close() {
      return (closePromise ??= close());
    },
  };
}
