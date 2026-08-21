import { registerDrawingGameHandlers } from '../../../../examples/drawing-game/dist/real/application.js';
import { createScenarioApplication } from '../../../../examples/drawing-game/dist/real/target.js';
import { Server } from './handwritten-socket.mjs';

const origin = 'http://drawing-game.handwritten.test';

// [maintenance-snippet:start base-handwritten-bootstrap]
export function startHandwrittenApplication() {
  const server = new Server(origin);
  registerDrawingGameHandlers(server);
  return createScenarioApplication(server, origin, () => server.close());
}
// [maintenance-snippet:end base-handwritten-bootstrap]
