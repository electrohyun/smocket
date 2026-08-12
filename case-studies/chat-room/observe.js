import assert from 'node:assert/strict';
import { assertScenarioResult } from './assertions.js';
import { runScenario } from './bootstrap.js';

const first = assertScenarioResult(await runScenario());
const second = assertScenarioResult(await runScenario());
assert.deepEqual(second, first);

process.stdout.write(
  JSON.stringify({
    assertions: 'passed',
    repeatedRunMatches: true,
    observation: first,
  }),
);
