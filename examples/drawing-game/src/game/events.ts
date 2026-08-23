export const GAME_URL = 'http://drawing-game.example';
export const ROOM = 'room-1';
export const WORD = 'giraffe';
export const LABELS = ['A', 'B', 'C'] as const;

export type Label = (typeof LABELS)[number];
export type GamePhase = 'waiting' | 'countdown' | 'active' | 'ended';

export interface StrokeSegment {
  id: number;
  points: Array<[x: number, y: number]>;
  end?: true;
}

export interface Player {
  label: Label;
  role: 'drawer' | 'guesser';
  socketId: string;
}

export interface SessionState {
  room: string;
  phase: GamePhase;
  players: Player[];
  countdownEndsAt?: number;
  winner?: Label;
  word?: string;
}

export interface JoinResult {
  accepted: boolean;
  room: string;
  reason?: 'invalid-room' | 'invalid-player' | 'seat-occupied';
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
  'session-state': (state: SessionState) => void;
  'round-started': (result: { startedAt: number }) => void;
  word: (word: string) => void;
  stroke: (segment: StrokeSegment) => void;
  chat: (message: ChatMessage) => void;
  correct: (result: { word: string }) => void;
  announce: (result: RoundResult) => void;
}

export interface GameBroadcast {
  emit<Event extends keyof ServerToClientEvents>(
    event: Event,
    ...args: Parameters<ServerToClientEvents[Event]>
  ): void;
}

export interface GameSocket {
  readonly id: string;
  readonly handshake: { auth: Record<string, unknown> };
  join(room: string): void | Promise<void>;
  to(room: string): GameBroadcast;
  disconnect(force?: boolean): void;
  on(event: 'join', listener: ClientToServerEvents['join']): this;
  on(event: 'stroke', listener: ClientToServerEvents['stroke']): this;
  on(event: 'chat', listener: ClientToServerEvents['chat']): this;
  on(event: 'guess', listener: ClientToServerEvents['guess']): this;
  on(event: 'disconnect', listener: () => void): this;
}

export interface GameServer {
  on(event: 'connection', listener: (socket: GameSocket) => void): unknown;
  to(room: string): GameBroadcast;
}

export interface GameClient {
  readonly id?: string;
  readonly connected: boolean;
  on<Event extends keyof ServerToClientEvents>(
    event: Event,
    listener: ServerToClientEvents[Event],
  ): this;
  on(event: 'connect', listener: () => void): this;
  on(event: 'connect_error' | 'bridge_error', listener: (error: Error) => void): this;
  on(event: 'disconnect', listener: (reason: string) => void): this;
  emit<Event extends keyof ClientToServerEvents>(
    event: Event,
    ...args: Parameters<ClientToServerEvents[Event]>
  ): this;
  emitWithAck(event: 'join', room: string): Promise<JoinResult>;
  emitWithAck(event: 'guess', text: string): Promise<boolean>;
  disconnect(): this;
}
