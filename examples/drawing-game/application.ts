import { registerDrawingGameApplication } from './src/game/application.js';
import type { GameServer } from './src/game/events.js';

export * from './src/game/events.js';
export type DrawingGameServer = GameServer;

/** Node comparison wrapper; the browser example uses the visible three-second countdown. */
export function registerDrawingGameHandlers(io: GameServer): void {
  registerDrawingGameApplication(io, { countdownMs: 0 });
}
