import type { Server } from 'socket.io';

export const ROOM = 'room-1';
export const WORD = 'giraffe';
export const LABELS = ['A', 'B', 'C'] as const;

export type Label = (typeof LABELS)[number];

export interface StrokeSegment {
  id: number;
  points: Array<[x: number, y: number]>;
  end?: true;
}

export interface JoinResult {
  accepted: boolean;
  room: string;
}

export interface ChatMessage {
  from: Label;
  text: string;
}

export interface RoundResult {
  winner: Label;
  word: string;
}

export interface ClientToServerEvents {
  join: (room: string, acknowledge: (result: JoinResult) => void) => void;
  stroke: (segment: StrokeSegment) => void;
  chat: (text: string) => void;
  guess: (text: string, acknowledge: (correct: boolean) => void) => void;
}

export interface ServerToClientEvents {
  stroke: (segment: StrokeSegment) => void;
  chat: (message: ChatMessage) => void;
  correct: (result: { word: string }) => void;
  announce: (result: RoundResult) => void;
}

export type DrawingGameServer = Server<ClientToServerEvents, ServerToClientEvents>;

function isLabel(value: unknown): value is Label {
  return value === 'A' || value === 'B' || value === 'C';
}

/** The application handlers used unchanged by Real Socket.IO and Smocket. */
export function registerDrawingGameHandlers(io: DrawingGameServer): void {
  io.on('connection', (socket) => {
    const claimedLabel = socket.handshake.auth.label;
    if (!isLabel(claimedLabel)) {
      socket.disconnect(true);
      return;
    }

    const label = claimedLabel;
    // [snippet:start room-join]
    socket.on('join', async (room, acknowledge) => {
      if (room !== ROOM) {
        acknowledge({ accepted: false, room });
        return;
      }
      await socket.join(room);
      acknowledge({ accepted: true, room });
    });
    // [snippet:end room-join]

    // [snippet:start drawing-server-handler]
    socket.on('stroke', (segment) => {
      socket.to(ROOM).emit('stroke', segment);
    });
    // [snippet:end drawing-server-handler]

    // [snippet:start chat-guess-server-handler]
    socket.on('chat', (text) => {
      io.to(ROOM).emit('chat', { from: label, text });
    });

    socket.on('guess', (text, acknowledge) => {
      // [snippet:start acknowledgement]
      const correct = text === WORD;
      acknowledge(correct);
      // [snippet:end acknowledgement]

      if (!correct) {
        io.to(ROOM).emit('chat', { from: label, text });
        return;
      }

      // [snippet:start targeted-correct]
      io.to(socket.id).emit('correct', { word: WORD });
      // [snippet:end targeted-correct]
      // [snippet:start room-announce]
      io.to(ROOM).emit('announce', { winner: label, word: WORD });
      // [snippet:end room-announce]
    });
    // [snippet:end chat-guess-server-handler]
  });
}
