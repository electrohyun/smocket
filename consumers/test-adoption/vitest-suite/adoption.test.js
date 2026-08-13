import { expect, test } from 'vitest';
import { assertScenarioResult } from '../shared/assertions.js';
import { runScenario } from '../shared/bootstrap.js';

test('runs the unchanged chat application through the suite alias', async () => {
  expect(assertScenarioResult(await runScenario())).toBeDefined();
});
