import { Server, type DefaultEventsMap } from './index';
import type { DisconnectReason, Server as IoServer } from 'socket.io';
import type { Socket as IoClientSocket } from 'socket.io-client';

interface ClientToServerEvents {
  fire: (value: string) => void;
  guess: (text: string, ack: (accepted: boolean) => void) => void;
  message: (value: number) => void;
  new_namespace: (value: string) => void;
}

interface ServerToClientEvents {
  chat: (message: string) => void;
  done: (ack: () => void) => void;
  message: (value: string, count: number) => void;
  new_namespace: (value: string) => void;
  question: (message: string, ack: (answer: number) => void) => void;
}

interface InterServerEvents {
  health: () => void;
}

interface SocketData {
  userId: string;
}

interface ReservedClientToServerEvents {
  disconnect: () => void;
}

interface ReservedServerToClientEvents {
  disconnect: () => void;
}

// Socket.IO intentionally exposes catch-all lookups as a permissive callback array.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyListener = (...args: any[]) => void;

const annotatedIncomingCatchAll = (_event: string, _value: number): void => {};
const annotatedOutgoingCatchAll = (_event: string, _value: number): void => {};
declare const stringOrRegExpNamespace: string | RegExp;

export function assertTypedEventMapsCompile(): void {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    'http://localhost:3000',
  );

  const returnedServer: typeof io = io
    .use((socket, next) => {
      socket.data.userId = 'user-1';
      socket.on('guess', (text, ack) => {
        void text;
        ack(true);
      });
      next();
    })
    .use((socket, next) => {
      socket.emit('chat', 'middleware-ready');
      next();
    });

  const namespace = io.of('/typed');
  const returnedNamespace: typeof namespace = namespace.use((socket, next) => {
    socket.data.userId = 'namespace-user';
    socket.emit('chat', 'namespace-ready');
    next();
  });

  const regexpParent = io.of(/^\/tenant-/, (socket) => {
    socket.data.userId = 'regexp-user';
    socket.emit('chat', 'regexp-ready');
  });
  const returnedParentAliases: typeof regexpParent = regexpParent
    .send('parent message', 1)
    .write('parent message', 2);
  const parentCompressed: ReturnType<typeof regexpParent.to> = regexpParent.compress(false);
  const matcherParent = io.of((name, auth, next) => {
    const normalizedName: string = name;
    const tenant: unknown = auth.tenant;
    void normalizedName;
    void tenant;
    next(null, true);
  });
  const unionNamespace = io.of(stringOrRegExpNamespace);
  matcherParent.on('connection', (socket) => {
    socket.data.userId = 'matcher-user';
  });
  io.on('new_namespace', (dynamicNamespace) => {
    const childName: string = dynamicNamespace.name;
    dynamicNamespace.emit('chat', childName);
  });
  io.emit('new_namespace', 'server payload');
  // @ts-expect-error a matcher must report both an error and an allowed verdict
  io.of((_name, _auth, next) => next(true));
  // @ts-expect-error matcher auth is an object, not a scalar
  io.of((_name, auth, next) => next(null, auth === 'tenant'));
  // @ts-expect-error the optional listener receives a server socket, which has no name
  io.of(/^\/invalid-/, (socket) => void socket.name);

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
    const returnedFromMessageAliases: typeof socket = socket
      .send('server message', 1)
      .write('server message', 2)
      .compress(false);
    const compressedTimedSocket: ReturnType<typeof socket.timeout> = socket
      .timeout(100)
      .compress(false);
    socket.in('room').compress(false).emit('chat', 'hello');
    socket
      .in('room')
      .compress(false)
      .emit('question', 'value?', (answers) => {
        const responseValues: number[] = answers;
        void responseValues;
      });
    socket
      .onAny(annotatedIncomingCatchAll)
      .prependAny(annotatedIncomingCatchAll)
      .offAny(annotatedIncomingCatchAll)
      .onAnyOutgoing(annotatedOutgoingCatchAll)
      .prependAnyOutgoing(annotatedOutgoingCatchAll)
      .offAnyOutgoing(annotatedOutgoingCatchAll);
    const returnedFromCatchAlls: typeof socket = socket
      .prependAny((_event, ..._args) => {})
      .prependAnyOutgoing((_event, ..._args) => {});
    const incomingAnyListeners: AnyListener[] = socket.listenersAny();
    const outgoingAnyListeners: AnyListener[] = socket.listenersAnyOutgoing();
    socket.emit('new_namespace', 'server socket payload');
    const returnedServerSocket: typeof socket = socket.disconnect();
    socket.to('room').volatile.emit('chat', 'hello');
    socket.broadcast.to('room').volatile.emit('chat', 'hello');
    socket.broadcast.volatile.except('muted').emit('chat', 'hello');
    const answer: Promise<number> = socket.emitWithAck('question', 'value?');
    const timedAnswer: Promise<number> = socket.timeout(100).emitWithAck('question', 'value?');
    const volatileAnswer: Promise<number> = socket.volatile.emitWithAck('question', 'value?');
    socket.timeout(100).volatile.on('guess', (_text, ack) => ack(true));
    socket.volatile.timeout(100).join('room');
    socket.timeout(100).volatile.emit('question', 'value?', (error, answer) => {
      const timeoutError: Error = error;
      const value: number = answer;
      void timeoutError;
      void value;
    });
    const socketBroadcastAnswers: Promise<number[]> = socket.broadcast
      .timeout(100)
      .emitWithAck('question', 'value?');
    const socketTimeoutFirstAnswers: Promise<number[]> = socket
      .timeout(100)
      .broadcast.to('room')
      .except('muted')
      .emitWithAck('question', 'value?');
    const socketVolatileAnswers: Promise<number[]> = socket.broadcast.volatile
      .timeout(100)
      .emitWithAck('question', 'value?');
    void socketBroadcastAnswers;
    void socketTimeoutFirstAnswers;
    void socketVolatileAnswers;
    // @ts-expect-error an ack with no response value cannot back emitWithAck
    socket.emitWithAck('done');
    void answer;
    void returnedFromMessageAliases;
    void compressedTimedSocket;
    void timedAnswer;
    void volatileAnswer;
    void returnedFromCatchAlls;
    void incomingAnyListeners;
    void outgoingAnyListeners;
    void returnedServerSocket;

    // @ts-expect-error unknown incoming event
    socket.on('gues', () => {});
    // @ts-expect-error wrong outgoing payload
    socket.emit('chat', 42);
    // @ts-expect-error server send follows the mapped server-to-client message tuple
    socket.send(42, 'wrong');
    // @ts-expect-error room narrowing accepts only a room or room array
    socket.in(42);
    // @ts-expect-error compression accepts only a boolean
    socket.compress('false');
  });

  io.emit('chat', 'hello');
  const returnedFromServerAliases: typeof io = io
    .send('server message', 1)
    .write('server message', 2);
  const rootCompressed: ReturnType<typeof io.to> = io.compress(false);
  io.to('room').emit('chat', 'hello');
  io.compress(false).to('room').emit('chat', 'hello');
  io.compress(false).emit('question', 'value?', (answers) => {
    const responseValues: number[] = answers;
    void responseValues;
  });
  io.to('room').volatile.emit('chat', 'hello');
  io.volatile.in('room').except('muted').emit('chat', 'hello');
  io.of('/admin').to('room').volatile.emit('chat', 'hello');
  io.to('room')
    .timeout(100)
    .volatile.emit('question', 'value?', (error, answers) => {
      const timeoutError: Error = error;
      const values: number[] = answers;
      void timeoutError;
      void values;
    });
  io.to('room')
    .volatile.timeout(100)
    .emit('question', 'value?', (error, answers) => {
      const timeoutError: Error = error;
      const values: number[] = answers;
      void timeoutError;
      void values;
    });
  io.of('/admin').in('room').except('muted').emit('chat', 'hello');
  const typedNamespace = io.of('/typed-aliases');
  const returnedFromNamespaceAliases: typeof typedNamespace = typedNamespace
    .send('namespace message', 1)
    .write('namespace message', 2);
  const namespaceCompressed: ReturnType<typeof typedNamespace.to> = typedNamespace.compress(false);
  io.timeout(100).emit('question', 'value?', (error, answers) => {
    const timeoutError: Error = error;
    const values: number[] = answers;
    void timeoutError;
    void values;
  });
  const roomOperator = io.to('room');
  const timedRoomOperator = roomOperator.timeout(100);
  const serverBroadcastAnswers: Promise<number[]> = io
    .timeout(100)
    .emitWithAck('question', 'value?');
  const namespaceBroadcastAnswers: Promise<number[]> = io
    .of('/admin')
    .timeout(100)
    .emitWithAck('question', 'value?');
  const narrowingFirstAnswers: Promise<number[]> = io
    .to('room')
    .except('muted')
    .timeout(100)
    .emitWithAck('question', 'value?');
  const timeoutFirstAnswers: Promise<number[]> = io
    .timeout(100)
    .to('room')
    .except('muted')
    .emitWithAck('question', 'value?');
  const volatileFirstAnswers: Promise<number[]> = io.volatile
    .to('room')
    .timeout(100)
    .emitWithAck('question', 'value?');
  const timeoutVolatileAnswers: Promise<number[]> = timedRoomOperator.volatile.emitWithAck(
    'question',
    'value?',
  );
  // @ts-expect-error an ordinary broadcast event lacks the error-first collector shape until timeout decoration
  roomOperator.emitWithAck('question', 'value?');
  // @ts-expect-error an event without an acknowledgement cannot back broadcast emitWithAck
  timedRoomOperator.emitWithAck('chat', 'hello');
  // @ts-expect-error an acknowledgement with no response value cannot back broadcast emitWithAck
  timedRoomOperator.emitWithAck('done');
  // @ts-expect-error wrong broadcast Promise payload
  timedRoomOperator.emitWithAck('question', 42);
  // @ts-expect-error the caller does not supply the internal collector callback
  timedRoomOperator.emitWithAck('question', 'value?', () => undefined);
  // @ts-expect-error unknown broadcast Promise event
  timedRoomOperator.emitWithAck('questoin', 'value?');
  // @ts-expect-error multiple-response decoration returns an array
  const wrongBroadcastAnswers: Promise<number> = timedRoomOperator.emitWithAck(
    'question',
    'value?',
  );
  void roomOperator;
  void timedRoomOperator;
  void serverBroadcastAnswers;
  void namespaceBroadcastAnswers;
  void narrowingFirstAnswers;
  void timeoutFirstAnswers;
  void volatileFirstAnswers;
  void timeoutVolatileAnswers;
  void wrongBroadcastAnswers;

  const client = io.connect();
  const returnedFromConnect: typeof client = client.connect();
  const returnedFromDisconnect: typeof client = client.disconnect();
  const returnedFromClientAliases: typeof client = client
    .open()
    .close()
    .compress(false)
    .send('permissive', 1, { any: 'payload' });
  client.on('chat', (message) => {
    const text: string = message;
    void text;
  });
  client.emit('new_namespace', 'client payload');
  client.on('disconnect', (reason, description) => {
    const disconnectReason: IoClientSocket.DisconnectReason = reason;
    const disconnectDescription: Error | { description: string; context?: unknown } | undefined =
      description;
    void disconnectReason;
    void disconnectDescription;
  });
  const returnedFromClientCatchAlls: typeof client = client
    .prependAny((_event, ..._args) => {})
    .prependAnyOutgoing((_event, ..._args) => {});
  const clientIncomingAnyListeners: AnyListener[] = client.listenersAny();
  const clientOutgoingAnyListeners: AnyListener[] = client.listenersAnyOutgoing();
  client
    .onAny(annotatedIncomingCatchAll)
    .prependAny(annotatedIncomingCatchAll)
    .offAny(annotatedIncomingCatchAll)
    .onAnyOutgoing(annotatedOutgoingCatchAll)
    .prependAnyOutgoing(annotatedOutgoingCatchAll)
    .offAnyOutgoing(annotatedOutgoingCatchAll);
  const accepted: Promise<boolean> = client.emitWithAck('guess', 'answer');
  const timedAccepted: Promise<Error> = client.timeout(100).emitWithAck('guess', 'answer');
  const volatileAccepted: Promise<boolean> = client.volatile.emitWithAck('guess', 'answer');
  client.timeout(100).volatile.on('chat', (message) => void message);
  client.volatile.timeout(100).connect().disconnect();
  client.timeout(100).volatile.emit('guess', 'answer', (error, accepted) => {
    const timeoutError: Error = error;
    const value: boolean = accepted;
    void timeoutError;
    void value;
  });
  // Socket.IO client permits every mapped event here, including one without an ack.
  const nonAck: Promise<unknown> = client.emitWithAck('fire');
  void accepted;
  void timedAccepted;
  void volatileAccepted;
  void nonAck;
  void returnedServer;
  void returnedFromServerAliases;
  void rootCompressed;
  void returnedNamespace;
  void returnedFromNamespaceAliases;
  void namespaceCompressed;
  void regexpParent;
  void returnedParentAliases;
  void parentCompressed;
  void matcherParent;
  void unionNamespace;
  void returnedFromConnect;
  void returnedFromDisconnect;
  void returnedFromClientAliases;
  void returnedFromClientCatchAlls;
  void clientIncomingAnyListeners;
  void clientOutgoingAnyListeners;

  // @ts-expect-error unknown server event
  io.emit('caht', 'hello');
  // @ts-expect-error the ServerSideEvents slot does not implement multi-server delivery
  io.on('health', () => {});
  // @ts-expect-error wrong server payload
  io.emit('chat', 42);
  // @ts-expect-error Server send follows the mapped message tuple
  io.send('missing count');
  // @ts-expect-error Namespace write follows the mapped message tuple
  typedNamespace.write('wrong', 'count');
  // @ts-expect-error compression accepts only a boolean
  io.compress('false');
  // @ts-expect-error client compression accepts only a boolean
  client.compress('false');
  // @ts-expect-error narrowing through volatile must retain the outgoing event map
  io.to('room').volatile.emit('chat', 42);
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

export function assertMappedReservedNamesStaySocketIoCompatible(): void {
  const io = new Server<ReservedClientToServerEvents, ReservedServerToClientEvents>(
    'http://localhost:3003',
  );

  io.emit('disconnect');
  io.of('/').emit('disconnect');
  io.to('room').emit('disconnect');
  io.timeout(100).emit('disconnect');
  io.volatile.emit('disconnect');

  io.on('connection', (socket) => {
    socket.emit('disconnect');
    socket.timeout(100).emit('disconnect');
    socket.volatile.emit('disconnect');
  });

  const client = io.connect();
  client.emit('disconnect');
  client.timeout(100).emit('disconnect');
  client.volatile.emit('disconnect');
  const direct = client.emitWithAck('disconnect');
  const timed = client.timeout(100).emitWithAck('disconnect');
  const volatile = client.volatile.emitWithAck('disconnect');
  void direct;
  void timed;
  void volatile;
  void io.close();
}

export function assertRealSocketIoListenerInferenceCompiles(
  io: IoServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
): void {
  const returnedServer: typeof io = io
    .use((socket, next) => {
      socket.data.userId = 'real-user';
      socket.on('guess', (text, ack) => {
        void text;
        ack(true);
      });
      next();
    })
    .use((socket, next) => {
      socket.emit('chat', 'real-middleware-ready');
      next();
    });

  const namespace = io.of('/real-typed');
  const returnedNamespace: typeof namespace = namespace.use((socket, next) => {
    socket.data.userId = 'real-namespace-user';
    socket.emit('chat', 'real-namespace-ready');
    next();
  });
  const regexpParent = io.of(/^\/real-tenant-/);
  const returnedParentAliases: typeof regexpParent = regexpParent
    .send('parent message', 1)
    .write('parent message', 2);
  const parentCompressed: ReturnType<typeof regexpParent.to> = regexpParent.compress(false);

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
    const returnedFromMessageAliases: typeof socket = socket
      .send('server message', 1)
      .write('server message', 2)
      .compress(false);
    const compressedTimedSocket: ReturnType<typeof socket.timeout> = socket
      .timeout(100)
      .compress(false);
    socket.in('room').compress(false).emit('chat', 'hello');
    socket
      .in('room')
      .compress(false)
      .emit('question', 'value?', (answers) => {
        const responseValues: number[] = answers;
        void responseValues;
      });
    const timedAnswer: Promise<number> = socket.timeout(100).emitWithAck('question', 'value?');
    const volatileAnswer: Promise<number> = socket.volatile.emitWithAck('question', 'value?');
    const returnedFromCatchAlls: typeof socket = socket
      .prependAny((_event, ..._args) => {})
      .prependAnyOutgoing((_event, ..._args) => {});
    const incomingAnyListeners: AnyListener[] = socket.listenersAny();
    const outgoingAnyListeners: AnyListener[] = socket.listenersAnyOutgoing();
    socket
      .onAny(annotatedIncomingCatchAll)
      .prependAny(annotatedIncomingCatchAll)
      .offAny(annotatedIncomingCatchAll)
      .onAnyOutgoing(annotatedOutgoingCatchAll)
      .prependAnyOutgoing(annotatedOutgoingCatchAll)
      .offAnyOutgoing(annotatedOutgoingCatchAll);
    socket.timeout(100).volatile.on('guess', (_text, ack) => ack(true));
    socket.volatile.timeout(100).join('room');
    socket.timeout(100).volatile.emit('question', 'value?', (error, answer) => {
      const timeoutError: Error = error;
      const value: number = answer;
      void timeoutError;
      void value;
    });
    const socketBroadcastAnswers: Promise<number[]> = socket.broadcast
      .timeout(100)
      .emitWithAck('question', 'value?');
    const socketTimeoutFirstAnswers: Promise<number[]> = socket
      .timeout(100)
      .broadcast.to('room')
      .except('muted')
      .emitWithAck('question', 'value?');
    const socketVolatileAnswers: Promise<number[]> = socket.broadcast.volatile
      .timeout(100)
      .emitWithAck('question', 'value?');
    void socketBroadcastAnswers;
    void socketTimeoutFirstAnswers;
    void socketVolatileAnswers;
    const returnedServerSocket: typeof socket = socket.disconnect();
    // @ts-expect-error an ack with no response value cannot back emitWithAck
    socket.emitWithAck('done');
    void answer;
    void returnedFromMessageAliases;
    void compressedTimedSocket;
    void timedAnswer;
    void volatileAnswer;
    void returnedFromCatchAlls;
    void incomingAnyListeners;
    void outgoingAnyListeners;
    void returnedServerSocket;
    // @ts-expect-error server send follows the mapped server-to-client message tuple
    socket.send(42, 'wrong');
    // @ts-expect-error room narrowing accepts only a room or room array
    socket.in(42);
    // @ts-expect-error compression accepts only a boolean
    socket.compress('false');
  });

  void returnedServer;
  void returnedNamespace;
  void returnedParentAliases;
  void parentCompressed;

  io.emit('chat', 'hello');
  const returnedFromServerAliases: typeof io = io
    .send('server message', 1)
    .write('server message', 2);
  const rootCompressed: ReturnType<typeof io.to> = io.compress(false);
  io.to('room').emit('chat', 'hello');
  io.compress(false).to('room').emit('chat', 'hello');
  io.compress(false).emit('question', 'value?', (answers) => {
    const responseValues: number[] = answers;
    void responseValues;
  });
  io.to('room').volatile.emit('chat', 'hello');
  io.volatile.in('room').except('muted').emit('chat', 'hello');
  io.of('/admin').to('room').volatile.emit('chat', 'hello');
  io.to('room')
    .timeout(100)
    .volatile.emit('question', 'value?', (error, answers) => {
      const timeoutError: Error = error;
      const values: number[] = answers;
      void timeoutError;
      void values;
    });
  io.of('/admin').in('room').except('muted').emit('chat', 'hello');
  const typedNamespace = io.of('/real-typed-aliases');
  const returnedFromNamespaceAliases: typeof typedNamespace = typedNamespace
    .send('namespace message', 1)
    .write('namespace message', 2);
  const namespaceCompressed: ReturnType<typeof typedNamespace.to> = typedNamespace.compress(false);
  io.timeout(100).emit('question', 'value?', (error, answers) => {
    const timeoutError: Error = error;
    const values: number[] = answers;
    void timeoutError;
    void values;
  });
  void returnedFromServerAliases;
  void rootCompressed;
  void returnedFromNamespaceAliases;
  void namespaceCompressed;
  // @ts-expect-error Server send follows the mapped message tuple
  io.send('missing count');
  // @ts-expect-error Namespace write follows the mapped message tuple
  typedNamespace.write('wrong', 'count');
  // @ts-expect-error compression accepts only a boolean
  io.compress('false');
  const serverBroadcastAnswers: Promise<number[]> = io
    .timeout(100)
    .emitWithAck('question', 'value?');
  const namespaceBroadcastAnswers: Promise<number[]> = io
    .of('/admin')
    .timeout(100)
    .emitWithAck('question', 'value?');
  const narrowingFirstAnswers: Promise<number[]> = io
    .to('room')
    .except('muted')
    .timeout(100)
    .emitWithAck('question', 'value?');
  const timeoutFirstAnswers: Promise<number[]> = io
    .timeout(100)
    .to('room')
    .except('muted')
    .emitWithAck('question', 'value?');
  const volatileAnswers: Promise<number[]> = io.volatile
    .to('room')
    .timeout(100)
    .emitWithAck('question', 'value?');
  // @ts-expect-error an ordinary broadcast event lacks the error-first collector shape until timeout decoration
  io.to('room').emitWithAck('question', 'value?');
  // @ts-expect-error an event without an acknowledgement cannot back broadcast emitWithAck
  io.timeout(100).emitWithAck('chat', 'hello');
  // @ts-expect-error an acknowledgement with no response value cannot back broadcast emitWithAck
  io.timeout(100).emitWithAck('done');
  // @ts-expect-error wrong broadcast Promise payload
  io.timeout(100).emitWithAck('question', 42);
  // @ts-expect-error the caller does not supply the internal collector callback
  io.timeout(100).emitWithAck('question', 'value?', () => undefined);
  // @ts-expect-error unknown broadcast Promise event
  io.timeout(100).emitWithAck('questoin', 'value?');
  void serverBroadcastAnswers;
  void namespaceBroadcastAnswers;
  void narrowingFirstAnswers;
  void timeoutFirstAnswers;
  void volatileAnswers;
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
  const returnedFromConnect: typeof client = client.connect();
  const returnedFromDisconnect: typeof client = client.disconnect();
  const returnedFromClientAliases: typeof client = client
    .open()
    .close()
    .compress(false)
    .send('permissive', 1, { any: 'payload' });
  const returnedFromCatchAlls: typeof client = client
    .prependAny((_event, ..._args) => {})
    .prependAnyOutgoing((_event, ..._args) => {});
  const incomingAnyListeners: AnyListener[] = client.listenersAny();
  const outgoingAnyListeners: AnyListener[] = client.listenersAnyOutgoing();
  client
    .onAny(annotatedIncomingCatchAll)
    .prependAny(annotatedIncomingCatchAll)
    .offAny(annotatedIncomingCatchAll)
    .onAnyOutgoing(annotatedOutgoingCatchAll)
    .prependAnyOutgoing(annotatedOutgoingCatchAll)
    .offAnyOutgoing(annotatedOutgoingCatchAll);
  const accepted: Promise<boolean> = client.emitWithAck('guess', 'answer');
  const timedAccepted: Promise<Error> = client.timeout(100).emitWithAck('guess', 'answer');
  const volatileAccepted: Promise<boolean> = client.volatile.emitWithAck('guess', 'answer');
  client.timeout(100).volatile.on('chat', (message) => void message);
  client.volatile.timeout(100).connect().disconnect();
  client.timeout(100).volatile.emit('guess', 'answer', (error, accepted) => {
    const timeoutError: Error = error;
    const value: boolean = accepted;
    void timeoutError;
    void value;
  });
  const nonAck: Promise<unknown> = client.emitWithAck('fire');
  void accepted;
  void timedAccepted;
  void volatileAccepted;
  void nonAck;
  void returnedFromConnect;
  void returnedFromDisconnect;
  void returnedFromClientAliases;
  void returnedFromCatchAlls;
  void incomingAnyListeners;
  void outgoingAnyListeners;
  // @ts-expect-error client compression accepts only a boolean
  client.compress('false');
}

export function assertRealSocketIoMappedReservedNamesCompile(
  io: IoServer<ReservedClientToServerEvents, ReservedServerToClientEvents>,
  client: IoClientSocket<ReservedServerToClientEvents, ReservedClientToServerEvents>,
): void {
  io.emit('disconnect');
  io.of('/').emit('disconnect');
  io.to('room').emit('disconnect');
  io.timeout(100).emit('disconnect');
  io.volatile.emit('disconnect');

  io.on('connection', (socket) => {
    socket.emit('disconnect');
    socket.timeout(100).emit('disconnect');
    socket.volatile.emit('disconnect');
  });

  client.emit('disconnect');
  client.timeout(100).emit('disconnect');
  client.volatile.emit('disconnect');
  const direct = client.emitWithAck('disconnect');
  const timed = client.timeout(100).emitWithAck('disconnect');
  const volatile = client.volatile.emitWithAck('disconnect');
  void direct;
  void timed;
  void volatile;
}

export type AssertDefaultEventsMapIsPublic = DefaultEventsMap;
