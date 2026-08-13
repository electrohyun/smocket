import { expect, test, vi } from 'vitest';

vi.mock('socket.io-client', () => vi.importActual(process.env.SMOCKET_CLIENT_TARGET ?? 'smocket'));

const { assertScenarioResult } = await import('../shared/assertions.js');
const { runScenario } = await import('../shared/bootstrap.js');

test('runs the unchanged chat application through a hoisted file mock', async () => {
  expect(assertScenarioResult(await runScenario())).toBeDefined();
});
