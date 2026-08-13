import * as mappedClient from 'socket.io-client';
import { expect, test, vi } from 'vitest';
import { assertScenarioResult } from '../shared/assertions.js';
import { runScenario } from '../shared/bootstrap.js';

test('maps the client import to the selected substitute', async () => {
  const selectedClient = await vi.importActual(process.env.SMOCKET_CLIENT_TARGET ?? 'smocket');

  expect(mappedClient.io).toBe(selectedClient.io);
  expect(mappedClient.connect).toBe(selectedClient.connect);
});

test('runs the unchanged chat application through the suite alias', async () => {
  expect(assertScenarioResult(await runScenario())).toBeDefined();
});
