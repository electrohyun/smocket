import { pathToFileURL } from 'node:url';
import { Server as SmocketServer } from 'smocket';
import { registerDrawingGameHandlers, type ClientToServerEvents } from './application.js';
import { assertScenarioObservation } from './assertions.js';
import {
  runDrawingGameScenario,
  type ScenarioApplication,
  type ScenarioTarget,
} from './scenario.js';
import { createScenarioApplication } from './target.js';
import type { ServerToClientEvents } from './application.js';

let nextOrigin = 0;

// [snippet:start smocket-bootstrap]
export function startSmocketApplication(): ScenarioApplication {
  nextOrigin += 1;
  const url = `http://drawing-game-${nextOrigin}.smocket.test`;
  const io = new SmocketServer<ClientToServerEvents, ServerToClientEvents>(url);
  registerDrawingGameHandlers(io);

  return createScenarioApplication(io, url, () => io.close());
}
// [snippet:end smocket-bootstrap]

export const smocketTarget: ScenarioTarget = {
  id: 'smocket',
  start: startSmocketApplication,
};

export async function observeSmocketTarget() {
  return assertScenarioObservation(await runDrawingGameScenario(smocketTarget));
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  console.log(JSON.stringify(await observeSmocketTarget(), null, 2));
}
