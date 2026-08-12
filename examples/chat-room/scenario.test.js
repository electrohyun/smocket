import assert from 'node:assert/strict';
import test from 'node:test';
import { runScenario } from './scenario.js';

const expectedTranscript = [
  '[alice] Welcome to #general.',
  '[alice] Welcome to #support.',
  '[bob] Welcome to #general.',
  '[carol] Welcome to #support.',
  '[alice] Bob in #general: Hello, everyone!',
  '[bob] Announcement rejected: moderator-only',
  '[alice] Alice to #general, #support: Maintenance starts at 18:00.',
  '[bob] Alice to #general, #support: Maintenance starts at 18:00.',
  '[carol] Alice to #general, #support: Maintenance starts at 18:00.',
  '[alice] Bob left #general.',
];

async function assertScenario() {
  const result = await runScenario();

  assert.deepEqual(
    result.joins.map(({ participantId, channel, acknowledgement }) => ({
      participantId,
      channel,
      acknowledgement,
    })),
    [
      {
        participantId: 'alice',
        channel: 'general',
        acknowledgement: { accepted: true, channel: 'general' },
      },
      {
        participantId: 'alice',
        channel: 'support',
        acknowledgement: { accepted: true, channel: 'support' },
      },
      {
        participantId: 'bob',
        channel: 'general',
        acknowledgement: { accepted: true, channel: 'general' },
      },
      {
        participantId: 'carol',
        channel: 'support',
        acknowledgement: { accepted: true, channel: 'support' },
      },
    ],
  );
  assert.deepEqual(result.messages, {
    alice: [{ channel: 'general', from: 'Bob', text: 'Hello, everyone!' }],
    bob: [],
    carol: [],
  });
  assert.deepEqual(result.rejectedAnnouncement, {
    accepted: false,
    reason: 'moderator-only',
  });
  assert.deepEqual(result.announcementAcknowledgement, {
    accepted: true,
    channels: ['general', 'support'],
  });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result.announcements).map(([participantId, events]) => [
        participantId,
        events.length,
      ]),
    ),
    { alice: 1, bob: 1, carol: 1 },
  );
  assert.deepEqual(result.departures, {
    alice: [{ channel: 'general', participant: 'Bob' }],
    bob: [],
    carol: [],
  });
  assert.deepEqual(result.transcript, expectedTranscript);
}

test('runs the moderated chat workflow deterministically and cleans up each run', async () => {
  await assertScenario();
  await assertScenario();
});
