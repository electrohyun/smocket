import { io, type Socket } from 'socket.io-client';
import {
  ROOM,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinResult,
  type Label,
  type RoundResult,
  type ServerToClientEvents,
  type StrokeSegment,
} from './application.js';

export type DrawingGameClient = Socket<ServerToClientEvents, ClientToServerEvents>;

/** This import and constructor stay unchanged when the target becomes Smocket. */
export function createDrawingGameClient(url: string, label: Label): DrawingGameClient {
  return io(url, {
    auth: { label },
    forceNew: true,
  });
}

export function waitForConnection(client: DrawingGameClient): Promise<void> {
  if (client.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const connected = () => {
      client.off('connect_error', failed);
      resolve();
    };
    const failed = (error: Error) => {
      client.off('connect', connected);
      reject(error);
    };

    client.once('connect', connected);
    client.once('connect_error', failed);
  });
}

export function joinGame(client: DrawingGameClient): Promise<JoinResult> {
  return new Promise((resolve) => client.emit('join', ROOM, resolve));
}

// [snippet:start drawing-client]
export function receiveStrokes(
  client: DrawingGameClient,
  receive: (segment: StrokeSegment) => void,
): void {
  client.on('stroke', receive);
}

export function sendStroke(client: DrawingGameClient, segment: StrokeSegment): void {
  client.emit('stroke', segment);
}
// [snippet:end drawing-client]

// [snippet:start chat-guess-client]
export function receiveChat(client: DrawingGameClient, receive: (message: ChatMessage) => void) {
  client.on('chat', receive);
}

export function receiveCorrect(client: DrawingGameClient, receive: (word: string) => void) {
  client.on('correct', ({ word }) => receive(word));
}

export function receiveAnnouncement(
  client: DrawingGameClient,
  receive: (result: RoundResult) => void,
) {
  client.on('announce', receive);
}

export function submitGuess(client: DrawingGameClient, text: string): Promise<boolean> {
  return new Promise((resolve) => client.emit('guess', text, resolve));
}
// [snippet:end chat-guess-client]
