import assert from 'node:assert/strict';
import test from 'node:test';
import { assertScenarioResult } from './assertions.js';
import { runScenario } from './bootstrap.js';

async function assertScenario() {
  const result = await runScenario();
  return assertScenarioResult(result);
}

test('runs the moderated chat workflow deterministically and cleans up each run', async () => {
  const first = await assertScenario();
  const second = await assertScenario();
  assert.deepEqual(second, first);
});
