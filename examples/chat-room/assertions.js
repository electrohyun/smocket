import assert from 'node:assert/strict';

const announcement = {
  channels: ['general', 'support'],
  from: 'Alice',
  text: 'Maintenance starts at 18:00.',
};

export const expectedObservation = {
  joins: [
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
  welcomes: {
    alice: [
      { channel: 'general', text: 'Welcome to #general.' },
      { channel: 'support', text: 'Welcome to #support.' },
    ],
    bob: [{ channel: 'general', text: 'Welcome to #general.' }],
    carol: [{ channel: 'support', text: 'Welcome to #support.' }],
  },
  messages: {
    alice: [{ channel: 'general', from: 'Bob', text: 'Hello, everyone!' }],
    bob: [],
    carol: [],
  },
  rejectedAnnouncement: {
    accepted: false,
    reason: 'moderator-only',
  },
  announcementAcknowledgement: {
    accepted: true,
    channels: ['general', 'support'],
  },
  announcements: {
    alice: [announcement],
    bob: [announcement],
    carol: [announcement],
  },
  departures: {
    alice: [{ channel: 'general', participant: 'Bob' }],
    bob: [],
    carol: [],
  },
  transcript: [
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
  ],
};

export function selectObservation(result) {
  return {
    joins: result.joins.map(({ participantId, channel, acknowledgement }) => ({
      participantId,
      channel,
      acknowledgement,
    })),
    welcomes: result.welcomes,
    messages: result.messages,
    rejectedAnnouncement: result.rejectedAnnouncement,
    announcementAcknowledgement: result.announcementAcknowledgement,
    announcements: result.announcements,
    departures: result.departures,
    transcript: result.transcript,
  };
}

export function assertScenarioResult(result) {
  const observation = selectObservation(result);
  assert.deepEqual(observation, expectedObservation);
  return observation;
}
