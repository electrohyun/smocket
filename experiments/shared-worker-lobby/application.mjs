const EXPECTED_PLAYERS = 3;

export function createLobbyApplication(io) {
  const players = new Map();
  const rooms = new Map();

  function roomPlayers(room) {
    let members = rooms.get(room);
    if (!members) {
      members = new Map();
      rooms.set(room, members);
    }
    return members;
  }

  function canStart(room) {
    const members = rooms.get(room);
    return (
      members?.size === EXPECTED_PLAYERS && [...members.values()].every((player) => player.ready)
    );
  }

  function removePlayer(socket) {
    const player = players.get(socket.id);
    if (!player) return undefined;
    players.delete(socket.id);
    const members = rooms.get(player.room);
    members?.delete(socket.id);
    if (members?.size === 0) {
      rooms.delete(player.room);
    } else if (player.leader) {
      const nextLeader = members?.values().next().value;
      if (nextLeader) {
        nextLeader.leader = true;
        io.to(nextLeader.sid).emit('can-start', canStart(player.room));
      }
    }
    socket.to(player.room).emit('player-left', { label: player.label });
    return player;
  }

  io.on('connection', (socket) => {
    const label = socket.handshake.auth.label;
    if (label !== 'A' && label !== 'B' && label !== 'C') {
      socket.disconnect(true);
      return;
    }

    socket.on('join-lobby', async (room, acknowledge) => {
      const existing = removePlayer(socket);
      if (existing) await socket.leave(existing.room);
      await socket.join(room);
      const members = roomPlayers(room);
      const player = { sid: socket.id, label, room, ready: false, leader: members.size === 0 };
      members.set(socket.id, player);
      players.set(socket.id, player);
      acknowledge({ accepted: true, room, leader: player.leader });
    });

    socket.on('get-can-start', (acknowledge) =>
      acknowledge(canStart(players.get(socket.id)?.room)),
    );

    socket.on('ready', (ready) => {
      const player = players.get(socket.id);
      if (!player) return;
      player.ready = ready === true;
      socket.to(player.room).emit('player-ready', { label, ready: player.ready });
      const leader = [...(rooms.get(player.room)?.values() ?? [])].find((entry) => entry.leader);
      if (leader) io.to(leader.sid).emit('can-start', canStart(player.room));
    });

    socket.on('start-game', (acknowledge) => {
      const player = players.get(socket.id);
      const accepted = Boolean(player?.leader && canStart(player.room));
      if (accepted) io.to(player.room).emit('start-game', { room: player.room });
      acknowledge({ accepted });
    });

    socket.on('ordered', (value) => {
      const player = players.get(socket.id);
      if (player) socket.to(player.room).emit('ordered', value);
    });

    socket.on('marker', (token) => {
      const player = players.get(socket.id);
      if (player) io.to(player.room).emit('marker', token);
    });

    socket.on('client-ack-probe', (token, acknowledge) => {
      acknowledge({ token, answer: 'first' });
      acknowledge({ token, answer: 'second' });
    });

    socket.on('server-ack-probe', (token) => {
      let calls = 0;
      socket.emit('server-ack-request', token, (answer) => {
        calls += 1;
        socket.emit('server-ack-result', { token, answer, calls });
      });
    });

    socket.on('request-pending-server-ack', (token) => {
      socket.emit('pending-server-ack', token, () => undefined);
    });

    socket.on('never-ack', () => undefined);
    socket.on('disconnecting', () => removePlayer(socket));
  });

  return {
    inspect(room) {
      const namespace = io.of('/');
      return {
        lobbyPlayers: players.size,
        lobbyRooms: rooms.size,
        roomMembers: namespace.adapter.rooms.get(room)?.size ?? 0,
        serverSockets: namespace.sockets.size,
      };
    },
  };
}
