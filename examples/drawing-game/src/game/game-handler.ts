import type { ChatMessage, GameServer, GameSocket, StrokeSegment } from './events.js';
import type { GuessAction, JoinAction } from './game-state.js';

export interface GameActions {
  join(socket: GameSocket, room: string): JoinAction;
  joined(action: JoinAction): void;
  stroke(socket: GameSocket, segment: StrokeSegment): string | null;
  chat(socket: GameSocket, text: string): { room: string; message: ChatMessage } | null;
  guess(socket: GameSocket, text: string): GuessAction;
  guessed(action: GuessAction): void;
  disconnect(socket: GameSocket): void;
}

/** The live-coded Socket.IO-shaped flow used by both server bootstraps. */
export function registerGameHandler(io: GameServer, socket: GameSocket, game: GameActions): void {
  // [snippet:start live-game-handler]
  // [snippet:start room-join]
  socket.on('join', async (room, acknowledge) => {
    const joined = game.join(socket, room);
    if (joined.accepted) await socket.join(joined.room);
    acknowledge(joined.result);
    game.joined(joined);
  });
  // [snippet:end room-join]
  // [snippet:start drawing-server-handler]
  socket.on('stroke', (stroke) => {
    const room = game.stroke(socket, stroke);
    if (room) socket.to(room).emit('stroke', stroke);
  });
  // [snippet:end drawing-server-handler]
  // [snippet:start chat-guess-server-handler]
  socket.on('guess', (text, acknowledge) => {
    const result = game.guess(socket, text);
    // [snippet:start acknowledgement]
    acknowledge(result.correct);
    // [snippet:end acknowledgement]
    if (result.chat) io.to(result.room).emit('chat', result.chat);
    // [snippet:start targeted-correct]
    if (result.round) io.to(socket.id).emit('correct', { word: result.round.word });
    // [snippet:end targeted-correct]
    // [snippet:start room-announce]
    if (result.round) io.to(result.room).emit('announce', result.round);
    // [snippet:end room-announce]
    game.guessed(result);
  });
  // [snippet:end chat-guess-server-handler]
  // [snippet:end live-game-handler]
  socket.on('chat', (text) => {
    const result = game.chat(socket, text);
    if (result) io.to(result.room).emit('chat', result.message);
  });
  socket.on('disconnect', () => game.disconnect(socket));
}
