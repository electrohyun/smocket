const scenarioMarker = 'scenario:marker';
const participantIds = ['alice', 'bob', 'carol'];

function observe(client, event) {
  const events = [];
  const waiters = [];

  client.on(event, (payload) => {
    events.push(payload);

    for (const waiter of [...waiters]) {
      if (!waiter.matches(payload)) continue;

      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(payload);
    }
  });

  return {
    events,
    next(matches = () => true) {
      return new Promise((resolve) => {
        waiters.push({ matches, resolve });
      });
    },
  };
}

function observeParticipant(client) {
  return {
    connected: observe(client, 'connect'),
    welcomes: observe(client, 'welcome'),
    messages: observe(client, 'room-message'),
    announcements: observe(client, 'announcement'),
    departures: observe(client, 'participant-left'),
    markers: observe(client, scenarioMarker),
  };
}

function requireAccepted(result, action) {
  if (!result.accepted) {
    throw new Error(`${action} was rejected: ${result.reason}`);
  }
}

function requireRejected(result, reason, action) {
  if (result.accepted || result.reason !== reason) {
    throw new Error(`${action} returned an unexpected result`);
  }
}

async function markSockets(application, clients, observers, participantIdsToMark, marker) {
  const received = participantIdsToMark.map((participantId) =>
    observers[participantId].markers.next((value) => value === marker),
  );

  for (const participantId of participantIdsToMark) {
    application.io.to(clients[participantId].id).emit(scenarioMarker, marker);
  }

  await Promise.all(received);
}

function formatTranscript(result) {
  return [
    ...result.welcomes.alice.map((event) => `[alice] ${event.text}`),
    ...result.welcomes.bob.map((event) => `[bob] ${event.text}`),
    ...result.welcomes.carol.map((event) => `[carol] ${event.text}`),
    ...result.messages.alice.map(
      (event) => `[alice] ${event.from} in #${event.channel}: ${event.text}`,
    ),
    `[bob] Announcement rejected: ${result.rejectedAnnouncement.reason}`,
    ...participantIds.flatMap((participantId) =>
      result.announcements[participantId].map(
        (event) =>
          `[${participantId}] ${event.from} to ${event.channels.map((channel) => `#${channel}`).join(', ')}: ${event.text}`,
      ),
    ),
    ...result.departures.alice.map(
      (event) => `[alice] ${event.participant} left #${event.channel}.`,
    ),
  ];
}

export async function runChatRoomScenario({ createClient, startApplication }) {
  const application = await startApplication();
  const clients = {};
  const activations = {};

  try {
    for (const participantId of participantIds) {
      const connection = createClient(application.url, { auth: { participantId } });
      clients[participantId] = connection.client;
      activations[participantId] = connection.activate;
    }

    const observers = Object.fromEntries(
      participantIds.map((participantId) => [
        participantId,
        observeParticipant(clients[participantId]),
      ]),
    );

    for (const participantId of participantIds) {
      activations[participantId]();
    }

    await Promise.all(participantIds.map((id) => observers[id].connected.next()));

    const joins = [];
    for (const [participantId, channel] of [
      ['alice', 'general'],
      ['alice', 'support'],
      ['bob', 'general'],
      ['carol', 'support'],
    ]) {
      const welcomed = observers[participantId].welcomes.next((event) => event.channel === channel);
      const acknowledged = clients[participantId].emitWithAck('join-channel', channel);
      const [welcome, acknowledgement] = await Promise.all([welcomed, acknowledged]);
      requireAccepted(acknowledgement, `${participantId} joining ${channel}`);
      joins.push({ participantId, channel, acknowledgement, welcome });
    }

    const messageReceived = observers.alice.messages.next(
      (event) => event.channel === 'general' && event.from === 'Bob',
    );
    const messageAcknowledgement = await clients.bob.emitWithAck(
      'room-message',
      'general',
      'Hello, everyone!',
    );
    requireAccepted(messageAcknowledgement, 'Bob sending a room message');
    await messageReceived;
    await markSockets(application, clients, observers, participantIds, 'after-room-message');

    const rejectedAnnouncement = await clients.bob.emitWithAck(
      'moderator-announcement',
      'This should not be delivered.',
    );
    requireRejected(rejectedAnnouncement, 'moderator-only', "Bob's announcement");
    await markSockets(application, clients, observers, ['bob'], 'after-rejected-announcement');

    const announcementAcknowledgement = await clients.alice.emitWithAck(
      'moderator-announcement',
      'Maintenance starts at 18:00.',
    );
    requireAccepted(announcementAcknowledgement, 'Alice sending an announcement');
    await markSockets(application, clients, observers, participantIds, 'after-announcement');

    const departureReceived = observers.alice.departures.next(
      (event) => event.channel === 'general' && event.participant === 'Bob',
    );
    clients.bob.disconnect();
    await departureReceived;
    await markSockets(application, clients, observers, ['carol'], 'after-bob-disconnected');

    const result = {
      joins,
      welcomes: Object.fromEntries(
        participantIds.map((id) => [id, [...observers[id].welcomes.events]]),
      ),
      messages: Object.fromEntries(
        participantIds.map((id) => [id, [...observers[id].messages.events]]),
      ),
      rejectedAnnouncement,
      announcementAcknowledgement,
      announcements: Object.fromEntries(
        participantIds.map((id) => [id, [...observers[id].announcements.events]]),
      ),
      departures: Object.fromEntries(
        participantIds.map((id) => [id, [...observers[id].departures.events]]),
      ),
    };

    return { ...result, transcript: formatTranscript(result) };
  } finally {
    await application.close().finally(() => {
      for (const client of Object.values(clients)) {
        if (client.connected) client.disconnect();
      }
    });
  }
}
