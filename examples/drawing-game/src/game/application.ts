import { registerGameHandler, type GameActions } from './game-handler.js';
import {
  DrawingGameState,
  type GuessAction,
  type JoinAction,
  type SessionRecord,
} from './game-state.js';
import {
  WORD,
  type GameServer,
  type GameSocket,
  type Label,
  type StrokeSegment,
} from './events.js';

export interface DrawingGameOptions {
  countdownMs?: number;
  now?: () => number;
}

function socketLabel(socket: GameSocket): Label | null {
  const value = socket.handshake.auth.label;
  return value === 'A' || value === 'B' || value === 'C' ? value : null;
}

/** Worker-safe application state and lifecycle shared by Smocket and Socket.IO. */
export function registerDrawingGameApplication(
  io: GameServer,
  { countdownMs = 3000, now = Date.now }: DrawingGameOptions = {},
): void {
  const state = new DrawingGameState();

  const publish = (room: string, record: SessionRecord): void => {
    io.to(room).emit('session-state', state.snapshot(room, record));
  };

  const startRound = (room: string, record: SessionRecord): void => {
    if (record.phase !== 'countdown' || record.players.size !== 3) return;
    record.countdownTimer = undefined;
    record.countdownEndsAt = undefined;
    record.phase = 'active';
    publish(room, record);
    io.to(room).emit('round-started', { startedAt: now() });
    const drawer = record.players.get('A');
    if (drawer) io.to(drawer.socket.id).emit('word', WORD);
  };

  const resetCountdown = (room: string, record: SessionRecord): void => {
    if (record.countdownTimer) clearTimeout(record.countdownTimer);
    record.countdownTimer = undefined;
    record.countdownEndsAt = undefined;
    record.phase = 'waiting';
    publish(room, record);
  };

  const startCountdown = (room: string, record: SessionRecord): void => {
    if (record.phase !== 'waiting' || record.players.size !== 3) return;
    record.phase = 'countdown';
    record.countdownEndsAt = now() + countdownMs;
    publish(room, record);
    if (countdownMs === 0) startRound(room, record);
    else record.countdownTimer = setTimeout(() => startRound(room, record), countdownMs);
  };

  io.on('connection', (socket) => {
    const actions: GameActions = {
      join(current, room): JoinAction {
        return state.join(current, room);
      },
      joined(action): void {
        if (!action.accepted || !action.record) return;
        action.replaced?.disconnect(true);
        for (const stroke of action.record.strokes) io.to(action.socket.id).emit('stroke', stroke);
        if (socketLabel(action.socket) === 'A' && action.record.phase === 'active') {
          io.to(action.socket.id).emit('word', WORD);
        }
        publish(action.room, action.record);
        startCountdown(action.room, action.record);
      },
      stroke(current, segment): string | null {
        return state.rememberStroke(current, segment as StrokeSegment);
      },
      chat(current, text) {
        return state.chat(current, text);
      },
      guess(current, text): GuessAction {
        return state.guess(current, text);
      },
      guessed(action): void {
        if (!action.round) return;
        const record = state.sessions.get(action.room);
        if (record) publish(action.room, record);
      },
      disconnect(current): void {
        const departed = state.disconnect(current);
        if (!departed?.record) return;
        if (departed.record.phase === 'countdown') {
          resetCountdown(departed.room, departed.record);
        } else {
          publish(departed.room, departed.record);
        }
      },
    };
    registerGameHandler(io, socket, actions);
  });
}
