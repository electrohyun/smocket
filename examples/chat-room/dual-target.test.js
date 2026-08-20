import assert from 'node:assert/strict';
import test from 'node:test';
import { assertScenarioResult } from './assertions.js';
import { runChatRoomScenario } from './scenario.js';
import { targets } from './targets.js';

test('the chat-room workflow matches real Socket.IO and Smocket', async () => {
  const observations = {};

  for (const target of targets) {
    const result = await runChatRoomScenario(target);
    observations[target.id] = assertScenarioResult(result);
  }

  assert.deepEqual(observations.smocket, observations['socket.io']);
});
