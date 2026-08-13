import { expect, test } from 'vitest';
import { runScenario } from '../shared/bootstrap.js';

test('runs the runner-mapped application in Chromium', async () => {
  const result = await runScenario({ url: 'http://localhost:3016' });
  expect(result.announcements.carol).toEqual([
    {
      channels: ['general', 'support'],
      from: 'Alice',
      text: 'Maintenance starts at 18:00.',
    },
  ]);
});
