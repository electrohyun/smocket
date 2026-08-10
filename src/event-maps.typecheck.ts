import { Server, type DefaultEventsMap } from './index';
import type { DisconnectReason, Server as IoServer } from 'socket.io';
import type { Socket as IoClientSocket } from 'socket.io-client';

interface ClientToServerEvents {
  fire: (value: string) => void;
  guess: (text: string, ack: (accepted: boolean) => void) => void;
}

interface ServerToClientEvents {
  chat: (message: string) => void;
  done: (ack: () => void) => void;
  question: (message: string, ack: (answer: number) => void) => void;
}

interface InterServerEvents {
  health: () => void;
}

interface SocketData {
  userId: string;
}

export function assertTypedEventMapsCompile(): void {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    'http://localhost:3000',
  );

  io.use((socket, next) => {
    socket.data.userId = 'user-1';
    next();
  });

  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;
    void userId;

    socket.on('guess', (text, ack) => {
      const guess: string = text;
      void guess;
      ack(true);
    });

    socket.on('disconnect', (reason, description) => {
      const disconnectReason: DisconnectReason = reason;
      const disconnectDescription: { code: number } = description;
      void disconnectReason;
      void disconnectDescription;
    });

    socket.emit('chat', 'hello');
    const answer: Promise<number> = socket.emitWithAck('question', 'value?');
    const timedAnswer: Promise<number> = socket.timeout(100).emitWithAck('question', 'value?');
    const volatileAnswer: Promise<number> = socket.volatile.emitWithAck('question', 'value?');
    // @ts-expect-error an ack with no response value cannot back emitWithAck
    socket.emitWithAck('done');
    void answer;
    void timedAnswer;
    void volatileAnswer;

    // @ts-expect-error unknown incoming event
    socket.on('gues', () => {});
    // @ts-expect-error wrong outgoing payload
    socket.emit('chat', 42);
  });

  io.emit('chat', 'hello');
  io.to('room').emit('chat', 'hello');
  io.of('/admin').in('room').except('muted').emit('chat', 'hello');
  io.timeout(100).emit('question', 'value?', (error, answers) => {
    const timeoutError: Error = error;
    const values: number[] = answers;
    void timeoutError;
    void values;
  });

  const client = io.connect();
  client.on('chat', (message) => {
    const text: string = message;
    void text;
  });
  client.on('disconnect', (reason, description) => {
    const disconnectReason: IoClientSocket.DisconnectReason = reason;
    const disconnectDescription: Error | { description: string; context?: unknown } | undefined =
      description;
    void disconnectReason;
    void disconnectDescription;
  });
  const accepted: Promise<boolean> = client.emitWithAck('guess', 'answer');
  const timedAccepted: Promise<Error> = client.timeout(100).emitWithAck('guess', 'answer');
  const volatileAccepted: Promise<boolean> = client.volatile.emitWithAck('guess', 'answer');
  // Socket.IO client permits every mapped event here, including one without an ack.
  const nonAck: Promise<unknown> = client.emitWithAck('fire');
  void accepted;
  void timedAccepted;
  void volatileAccepted;
  void nonAck;

  // @ts-expect-error unknown server event
  io.emit('caht', 'hello');
  // @ts-expect-error the ServerSideEvents slot does not implement multi-server delivery
  io.on('health', () => {});
  // @ts-expect-error wrong server payload
  io.emit('chat', 42);
  // @ts-expect-error client emits the client-to-server map, not the reverse map
  client.emit('chat', 'hello');

  void io.close();
}

export function assertDefaultEventMapStaysUntyped(): void {
  const io = new Server('http://localhost:3001');
  io.on('anything', (...args) => void args);
  io.emit('anything', 1, true);
  io.connect().emit('anything', 1, true);
  void io.close();
}

export function assertSocketDataDefaultMatchesSocketIo(): void {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>('http://localhost:3002');
  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;
    void userId;
  });
  void io.close();
}

export function assertRealSocketIoListenerInferenceCompiles(
  io: IoServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
): void {
  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;
    void userId;
    socket.on('guess', (text, ack) => {
      const guess: string = text;
      void guess;
      ack(true);
    });
    socket.on('disconnect', (_reason, description) => {
      const disconnectDescription: { code: number } = description;
      void disconnectDescription;
    });
    const answer: Promise<number> = socket.emitWithAck('question', 'value?');
    const timedAnswer: Promise<number> = socket.timeout(100).emitWithAck('question', 'value?');
    const volatileAnswer: Promise<number> = socket.volatile.emitWithAck('question', 'value?');
    // @ts-expect-error an ack with no response value cannot back emitWithAck
    socket.emitWithAck('done');
    void answer;
    void timedAnswer;
    void volatileAnswer;
  });

  io.emit('chat', 'hello');
  io.to('room').emit('chat', 'hello');
  io.of('/admin').in('room').except('muted').emit('chat', 'hello');
  io.timeout(100).emit('question', 'value?', (error, answers) => {
    const timeoutError: Error = error;
    const values: number[] = answers;
    void timeoutError;
    void values;
  });
}

export function assertRealSocketIoDefaultsCompile(
  io: IoServer<ClientToServerEvents, ServerToClientEvents>,
): void {
  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;
    const disconnectListener = (reason: DisconnectReason): void => void reason;
    socket.on('disconnect', disconnectListener);
    void userId;
  });
}

export function assertRealSocketIoClientAckTypesCompile(
  client: IoClientSocket<ServerToClientEvents, ClientToServerEvents>,
): void {
  const accepted: Promise<boolean> = client.emitWithAck('guess', 'answer');
  const timedAccepted: Promise<Error> = client.timeout(100).emitWithAck('guess', 'answer');
  const volatileAccepted: Promise<boolean> = client.volatile.emitWithAck('guess', 'answer');
  const nonAck: Promise<unknown> = client.emitWithAck('fire');
  void accepted;
  void timedAccepted;
  void volatileAccepted;
  void nonAck;
}

export type AssertDefaultEventsMapIsPublic = DefaultEventsMap;
