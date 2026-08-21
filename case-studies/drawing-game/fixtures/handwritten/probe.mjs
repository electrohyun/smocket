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

const firstStages = await runHandwrittenStages();
const secondStages = await runHandwrittenStages();
assert.deepEqual(secondStages, firstStages);

const firstObservation = await observeFinalWorkflow();
const secondObservation = await observeFinalWorkflow();
assert.deepEqual(secondObservation, firstObservation);

process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    targetId: 'handwritten',
    label: 'Application-owned handwritten transport',
    fixture: 'case-studies/drawing-game/fixtures/handwritten',
    repeatedRunMatches: true,
    stages: firstStages,
    observation: firstObservation,
  }),
);
