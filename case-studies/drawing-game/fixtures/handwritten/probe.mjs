import assert from 'node:assert/strict';
import { assertScenarioObservation } from '../../../../examples/drawing-game/dist/real/assertions.js';
import { runDrawingGameScenario } from '../../../../examples/drawing-game/dist/real/scenario.js';
import { startHandwrittenApplication } from './bootstrap.mjs';
import { runHandwrittenStages } from './stages.mjs';

const handwrittenTarget = {
  id: 'handwritten',
  start: startHandwrittenApplication,
};

async function observeFinalWorkflow() {
  return assertScenarioObservation(await runDrawingGameScenario(handwrittenTarget));
}

async function runOnce() {
  const stages = await runHandwrittenStages();
  const observation = await observeFinalWorkflow();
  stages.push({
    id: 'full-workflow',
    passed: true,
    assertions: ['the unchanged golden drawing-game workflow satisfied its canonical assertions'],
  });
  return { stages, observation };
}

const first = await runOnce();
const second = await runOnce();
assert.deepEqual(second, first);

process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    targetId: 'handwritten',
    label: 'Application-owned handwritten transport',
    fixture: 'case-studies/drawing-game/fixtures/handwritten',
    repeatedRunMatches: true,
    stages: first.stages,
    observation: first.observation,
  }),
);
