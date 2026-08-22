export const LOBBY_URL = 'http://shared-worker-lobby.example';
export const ROOM = 'lobby';

export interface Player {
  id: string;
  label: string;
  ready: boolean;
  leader: boolean;
}

export interface LobbyState {
  players: Player[];
  canStart: boolean;
}

export interface ClientToServerEvents {
  ready: (acknowledge: (result: { accepted: boolean }) => void) => void;
  'start-game': (acknowledge: (result: { accepted: boolean }) => void) => void;
}

export interface ServerToClientEvents {
  'lobby-state': (state: LobbyState) => void;
  'game-started': (result: { by: string }) => void;
}

interface LobbySocket {
  readonly id: string;
  readonly handshake: { auth: Record<string, unknown> };
  join(room: string): void | Promise<void>;
  on(event: 'ready', listener: ClientToServerEvents['ready']): this;
  on(event: 'start-game', listener: ClientToServerEvents['start-game']): this;
  on(event: 'disconnect', listener: () => void): this;
}

interface LobbyBroadcast {
  emit<Event extends keyof ServerToClientEvents>(
    event: Event,
    ...args: Parameters<ServerToClientEvents[Event]>
  ): void;
}

export interface LobbyServer {
  on(event: 'connection', listener: (socket: LobbySocket) => void): unknown;
  to(room: string): LobbyBroadcast;
}

function readLabel(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'anonymous';
}

/** Register the same Socket.IO-shaped application handlers used by every tab. */
export function registerLobbyHandlers(io: LobbyServer): void {
  const players = new Map<string, Omit<Player, 'id' | 'leader'>>();

  const snapshot = (): LobbyState => {
    const leaderId = players.keys().next().value as string | undefined;
    const current = [...players].map(([id, player]) => ({
      id,
      ...player,
      leader: id === leaderId,
    }));
    return {
      players: current,
      canStart: current.length === 3 && current.every((player) => player.ready),
    };
  };

  const publish = (): void => {
    io.to(ROOM).emit('lobby-state', snapshot());
  };

  io.on('connection', async (socket) => {
    const label = readLabel(socket.handshake.auth.label);
    players.set(socket.id, { label, ready: false });
    await socket.join(ROOM);
    publish();

    socket.on('ready', (acknowledge) => {
      const player = players.get(socket.id);
      if (player) player.ready = true;
      acknowledge({ accepted: player !== undefined });
      if (player) publish();
    });

    socket.on('start-game', (acknowledge) => {
      const state = snapshot();
      const accepted = state.canStart && socket.id === players.keys().next().value;
      acknowledge({ accepted });
      if (accepted) io.to(ROOM).emit('game-started', { by: label });
    });

    socket.on('disconnect', () => {
      players.delete(socket.id);
      publish();
    });
  });
}
