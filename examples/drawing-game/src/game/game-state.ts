import {
  LABELS,
  WORD,
  type ChatMessage,
  type GamePhase,
  type GameSocket,
  type JoinResult,
  type Label,
  type RoundResult,
  type SessionState,
  type StrokeSegment,
} from './events.js';

interface Participant {
  socket: GameSocket;
  presenceId: string;
}

export interface SessionRecord {
  phase: GamePhase;
  players: Map<Label, Participant>;
  strokes: StrokeSegment[];
  countdownEndsAt?: number;
  countdownTimer?: ReturnType<typeof setTimeout>;
  winner?: Label;
}

interface Membership {
  room: string;
  label: Label;
}

export interface JoinAction {
  accepted: boolean;
  result: JoinResult;
  room: string;
  socket: GameSocket;
  record?: SessionRecord;
  replaced?: GameSocket;
}

export interface GuessAction {
  correct: boolean;
  room: string;
  chat?: ChatMessage;
  round?: RoundResult;
}

const ROOM_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function labelFrom(socket: GameSocket): Label | null {
  const value = socket.handshake.auth.label;
  return value === 'A' || value === 'B' || value === 'C' ? value : null;
}

function presenceFrom(socket: GameSocket): string {
  const value = socket.handshake.auth.presenceId;
  return typeof value === 'string' && value.trim() ? value.slice(0, 128) : socket.id;
}

export class DrawingGameState {
  readonly sessions = new Map<string, SessionRecord>();
  readonly memberships = new Map<string, Membership>();

  getSession(room: string): SessionRecord {
    const current = this.sessions.get(room);
    if (current) return current;
    const created: SessionRecord = { phase: 'waiting', players: new Map(), strokes: [] };
    this.sessions.set(room, created);
    return created;
  }

  snapshot(room: string, record = this.getSession(room)): SessionState {
    return {
      room,
      phase: record.phase,
      players: LABELS.flatMap((label) => {
        const participant = record.players.get(label);
        return participant
          ? [
              {
                label,
                role: label === 'A' ? ('drawer' as const) : ('guesser' as const),
                socketId: participant.socket.id,
              },
            ]
          : [];
      }),
      ...(record.countdownEndsAt === undefined ? {} : { countdownEndsAt: record.countdownEndsAt }),
      ...(record.winner === undefined ? {} : { winner: record.winner }),
      ...(record.phase === 'ended' ? { word: WORD } : {}),
    };
  }

  join(socket: GameSocket, room: string): JoinAction {
    if (!ROOM_PATTERN.test(room)) {
      return {
        accepted: false,
        result: { accepted: false, room, reason: 'invalid-room' },
        room,
        socket,
      };
    }
    const label = labelFrom(socket);
    if (!label) {
      return {
        accepted: false,
        result: { accepted: false, room, reason: 'invalid-player' },
        room,
        socket,
      };
    }
    const existing = this.memberships.get(socket.id);
    if (existing) {
      return {
        accepted: true,
        result: { accepted: true, room: existing.room },
        room: existing.room,
        socket,
        record: this.getSession(existing.room),
      };
    }

    const record = this.getSession(room);
    const occupied = record.players.get(label);
    const presenceId = presenceFrom(socket);
    if (occupied && occupied.presenceId !== presenceId) {
      return {
        accepted: false,
        result: { accepted: false, room, reason: 'seat-occupied' },
        room,
        socket,
      };
    }

    record.players.set(label, { socket, presenceId });
    this.memberships.set(socket.id, { room, label });
    if (occupied) this.memberships.delete(occupied.socket.id);
    return {
      accepted: true,
      result: { accepted: true, room },
      room,
      socket,
      record,
      ...(occupied && occupied.socket.id !== socket.id ? { replaced: occupied.socket } : {}),
    };
  }

  active(socket: GameSocket, role?: 'drawer' | 'guesser'): Membership | null {
    const membership = this.memberships.get(socket.id);
    if (!membership) return null;
    const record = this.sessions.get(membership.room);
    const canSendFinishedStroke = role === 'drawer' && record?.phase === 'ended';
    if (record?.phase !== 'active' && !canSendFinishedStroke) return null;
    if (record.players.get(membership.label)?.socket.id !== socket.id) return null;
    if (role === 'drawer' && membership.label !== 'A') return null;
    if (role === 'guesser' && membership.label === 'A') return null;
    return membership;
  }

  rememberStroke(socket: GameSocket, segment: StrokeSegment): string | null {
    const player = this.active(socket, 'drawer');
    if (!player) return null;
    this.sessions.get(player.room)?.strokes.push(segment);
    return player.room;
  }

  chat(socket: GameSocket, text: string): { room: string; message: ChatMessage } | null {
    const player = this.active(socket);
    const clean = text.trim();
    return player && clean
      ? { room: player.room, message: { from: player.label, text: clean } }
      : null;
  }

  guess(socket: GameSocket, text: string): GuessAction {
    const player = this.active(socket, 'guesser');
    const guess = text.trim();
    if (!player || !guess) return { correct: false, room: '' };
    const correct = guess.toLowerCase() === WORD;
    if (!correct) {
      return { correct, room: player.room, chat: { from: player.label, text: guess } };
    }
    const record = this.sessions.get(player.room);
    if (record) {
      record.phase = 'ended';
      record.winner = player.label;
    }
    return { correct, room: player.room, round: { winner: player.label, word: WORD } };
  }

  disconnect(socket: GameSocket): { room: string; record?: SessionRecord } | null {
    const membership = this.memberships.get(socket.id);
    this.memberships.delete(socket.id);
    if (!membership) return null;
    const record = this.sessions.get(membership.room);
    if (!record || record.players.get(membership.label)?.socket.id !== socket.id) return null;
    record.players.delete(membership.label);
    if (record.players.size === 0) {
      if (record.countdownTimer) clearTimeout(record.countdownTimer);
      this.sessions.delete(membership.room);
      return { room: membership.room };
    }
    return { room: membership.room, record };
  }
}
