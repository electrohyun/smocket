const channels = new Set(['general', 'support']);
const participantNames = new Map([
  ['alice', 'Alice'],
  ['bob', 'Bob'],
  ['carol', 'Carol'],
]);

// This fixture belongs to the server. A role claimed in client auth is never
// consulted when deciding whether an announcement is allowed.
const moderators = new Set(['alice']);

export function createChatApplication({ io, url, close }) {
  let closing = false;
  let closePromise;

  io.on('connection', (socket) => {
    const participantId = socket.handshake.auth.participantId;
    const participantName = participantNames.get(participantId) ?? participantId;

    socket.on('join-channel', async (channel, acknowledge) => {
      if (!channels.has(channel)) {
        acknowledge({ accepted: false, reason: 'unknown-channel' });
        return;
      }

      await socket.join(channel);
      io.to(socket.id).emit('welcome', {
        channel,
        text: `Welcome to #${channel}.`,
      });
      acknowledge({ accepted: true, channel });
    });

    socket.on('room-message', (channel, text, acknowledge) => {
      if (!channels.has(channel) || !socket.rooms.has(channel)) {
        acknowledge({ accepted: false, reason: 'not-in-channel' });
        return;
      }

      socket.to(channel).emit('room-message', {
        channel,
        from: participantName,
        text,
      });
      acknowledge({ accepted: true });
    });

    socket.on('moderator-announcement', (text, acknowledge) => {
      if (!moderators.has(participantId)) {
        acknowledge({ accepted: false, reason: 'moderator-only' });
        return;
      }

      const targetChannels = [...channels];
      io.to(targetChannels).emit('announcement', {
        channels: targetChannels,
        from: participantName,
        text,
      });
      acknowledge({ accepted: true, channels: targetChannels });
    });

    socket.on('disconnecting', () => {
      if (closing) return;

      for (const channel of socket.rooms) {
        if (!channels.has(channel)) continue;

        socket.to(channel).emit('participant-left', {
          channel,
          participant: participantName,
        });
      }
    });
  });

  return {
    io,
    close() {
      closing = true;
      closePromise ??= Promise.resolve(close());
      return closePromise;
    },
    url,
  };
}
