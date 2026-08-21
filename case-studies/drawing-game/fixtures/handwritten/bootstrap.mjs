import { registerDrawingGameHandlers } from '../../../../examples/drawing-game/dist/real/application.js';
import { createScenarioApplication } from '../../../../examples/drawing-game/dist/real/target.js';
import { Server } from './stage-sources/08-full-workflow.mjs';

const origin = 'http://drawing-game.handwritten.test';

export function startHandwrittenApplication() {
  const server = new Server(origin);
  registerDrawingGameHandlers(server);
  return createScenarioApplication(server, origin, () => server.close());
}
