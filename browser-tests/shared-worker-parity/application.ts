type Listener = (...args: unknown[]) => void;
type Acknowledge = (...args: unknown[]) => void;

interface EventEmitter {
  emit(event: string, ...args: unknown[]): unknown;
}

interface LobbySocket extends EventEmitter {
  readonly id: string;
  readonly handshake: { auth: Record<string, unknown> };
  join(room: string): void | Promise<void>;
  leave(room: string): void | Promise<void>;
  to(room: string): EventEmitter;
  on(event: string, listener: Listener): unknown;
  disconnect(close?: boolean): unknown;
}

export interface LobbyServer extends EventEmitter {
  on(event: 'connection', listener: (socket: LobbySocket) => void): unknown;
  to(room: string): EventEmitter;
  of(namespace: '/'): {
    readonly adapter: { readonly rooms: Map<string, Set<string>> };
    readonly sockets: Map<string, unknown>;
  };
}

interface Player {
  readonly sid: string;
  readonly label: string;
  readonly room: string;
  ready: boolean;
  leader: boolean;
}

const EXPECTED_PLAYERS = 3;

export function registerParityLobby(io: LobbyServer): void {
  const players = new Map<string, Player>();
  const rooms = new Map<string, Map<string, Player>>();

  const roomPlayers = (room: string): Map<string, Player> => {
    let members = rooms.get(room);
    if (!members) {
      members = new Map();
      rooms.set(room, members);
    }
    return members;
  };

  const canStart = (room: string | undefined): boolean => {
    const members = room === undefined ? undefined : rooms.get(room);
    return (
      members?.size === EXPECTED_PLAYERS && [...members.values()].every((player) => player.ready)
    );
  };

  const removePlayer = (socket: LobbySocket): Player | undefined => {
    const player = players.get(socket.id);
    if (!player) return undefined;
    players.delete(socket.id);
    const members = rooms.get(player.room);
    members?.delete(socket.id);
    if (members?.size === 0) rooms.delete(player.room);
    socket.to(player.room).emit('player-left', { label: player.label });
    return player;
  };

  io.on('connection', (socket) => {
    const label = String(socket.handshake.auth.label);

    socket.on('join-lobby', async (...args) => {
      const [room, acknowledge] = args as [string, Acknowledge];
      const existing = removePlayer(socket);
      if (existing) await socket.leave(existing.room);
      await socket.join(room);
      const members = roomPlayers(room);
      const player: Player = {
        sid: socket.id,
        label,
        room,
        ready: false,
        leader: members.size === 0,
      };
      members.set(socket.id, player);
      players.set(socket.id, player);
      acknowledge({ accepted: true, room, label, leader: player.leader });
    });

    socket.on('get-can-start', (...args) => {
      const acknowledge = args[0] as Acknowledge;
      acknowledge(canStart(players.get(socket.id)?.room));
    });

    socket.on('ready', (...args) => {
      const ready = args[0] === true;
      const player = players.get(socket.id);
      if (!player) return;
      player.ready = ready;
      socket.to(player.room).emit('player-ready', { label, ready });
      const leader = [...(rooms.get(player.room)?.values() ?? [])].find(
        (candidate) => candidate.leader,
      );
      if (leader) io.to(leader.sid).emit('can-start', canStart(player.room));
    });

    socket.on('start-game', (...args) => {
      const acknowledge = args[0] as Acknowledge;
      const player = players.get(socket.id);
      const accepted = Boolean(player?.leader && canStart(player.room));
      if (accepted && player) io.to(player.room).emit('start-game', { room: player.room });
      acknowledge({ accepted });
    });

    socket.on('ordered', (...args) => {
      const player = players.get(socket.id);
      if (player) socket.to(player.room).emit('ordered', args[0]);
    });

    socket.on('marker', (...args) => {
      const player = players.get(socket.id);
      if (player) io.to(player.room).emit('marker', args[0]);
    });

    socket.on('client-ack-probe', (...args) => {
      const [token, acknowledge] = args as [string, Acknowledge];
      acknowledge({ token, answer: 'first' });
      acknowledge({ token, answer: 'duplicate' });
    });

    socket.on('server-ack-probe', (...args) => {
      const token = args[0] as string;
      let calls = 0;
      socket.emit('server-ack-request', token, (answer: unknown) => {
        calls += 1;
        socket.emit('server-ack-result', { token, answer, calls });
      });
    });

    socket.on('inspect', (...args) => {
      const [room, acknowledge] = args as [string, Acknowledge];
      const namespace = io.of('/');
      acknowledge({
        players: players.size,
        roomMembers: namespace.adapter.rooms.get(room)?.size ?? 0,
        sockets: namespace.sockets.size,
      });
    });

    socket.on('disconnecting', () => removePlayer(socket));
  });
}
