import { Server, connect } from '/dist/index.js';
import { createLobbyApplication } from './application.mjs';
import { MESSAGE_TYPES, bridgeMessage, readProtocolMessage } from './protocol.mjs';

const workerId = crypto.randomUUID();
const io = new Server(globalThis.location.origin);
io.use((socket, next) => {
  if (socket.handshake.auth.holdConnection === true) return;
  next();
});
const lobby = createLobbyApplication(io);
const connections = new Map();
let nextGeneration = 0;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function post(port, type, fields) {
  port.postMessage(bridgeMessage(type, fields));
}

function totalPendingServerAcks() {
  let total = 0;
  for (const state of connections.values()) total += state.pendingServerAcks.size;
  return total;
}

function finishDisconnect(state, reason, notify) {
  if (state.finished) return;
  state.finished = true;
  state.pendingServerAcks.clear();
  if (connections.get(state.port) === state) connections.delete(state.port);
  if (notify)
    post(state.port, MESSAGE_TYPES.DISCONNECTED, { generation: state.generation, reason });
}

function disconnectState(state, reason, notify = true) {
  if (state.finished) return;
  state.disconnectReason = reason;
  if (state.socket) {
    state.notifyOnDisconnect = notify;
    state.socket.disconnect();
  }
  finishDisconnect(state, reason, notify);
}

function forwardServerEvent(state, event, incomingArgs) {
  if (state.finished) return;
  const args = [...incomingArgs];
  const acknowledgement = typeof args.at(-1) === 'function' ? args.pop() : undefined;
  let ackId;
  if (acknowledgement) {
    ackId = `server:${state.generation}:${++state.nextAck}`;
    state.pendingServerAcks.set(ackId, acknowledgement);
  }
  post(state.port, MESSAGE_TYPES.SERVER_EVENT, {
    generation: state.generation,
    event,
    args,
    ...(ackId ? { ackId } : {}),
  });
}

function connectPort(port, message) {
  const previous = connections.get(port);
  if (previous) disconnectState(previous, 'replaced connection', false);

  const state = {
    port,
    generation: ++nextGeneration,
    nextAck: 0,
    pendingServerAcks: new Map(),
    socket: undefined,
    finished: false,
    disconnectReason: undefined,
    notifyOnDisconnect: true,
  };
  connections.set(port, state);

  const socket = connect(message.url, { auth: message.auth });
  state.socket = socket;
  socket.onAny((event, ...args) => forwardServerEvent(state, event, args));
  socket.on('connect', () => {
    if (state.finished || connections.get(port) !== state) {
      socket.disconnect();
      return;
    }
    post(port, MESSAGE_TYPES.CONNECTED, {
      requestId: message.requestId,
      generation: state.generation,
      id: socket.id,
      workerId,
    });
  });
  socket.on('connect_error', (error) => {
    if (state.finished) return;
    post(port, MESSAGE_TYPES.CONNECT_ERROR, {
      requestId: message.requestId,
      error: errorMessage(error),
    });
    finishDisconnect(state, 'connect error', false);
  });
  socket.on('disconnect', (reason) => {
    finishDisconnect(state, state.disconnectReason ?? reason, state.notifyOnDisconnect);
  });
}

function replyToClientAck(state, ackId, args) {
  if (!ackId) return;
  post(state.port, MESSAGE_TYPES.ACK, {
    generation: state.generation,
    direction: 'client',
    ackId,
    args,
  });
}

function handleClientEmit(state, message) {
  if (message.event === 'experiment:inspect') {
    replyToClientAck(state, message.ackId, [
      {
        workerId,
        activeConnections: connections.size,
        pendingServerAcks: totalPendingServerAcks(),
        ...lobby.inspect(message.args[0]),
      },
    ]);
    return;
  }

  const args = [...message.args];
  if (message.ackId) {
    let answered = false;
    args.push((...ackArgs) => {
      if (answered || state.finished) return;
      answered = true;
      replyToClientAck(state, message.ackId, ackArgs);
    });
  }
  state.socket.emit(message.event, ...args);
}

function handleMessage(port, value) {
  let message;
  try {
    message = readProtocolMessage(value);
    if (message.type === MESSAGE_TYPES.CONNECT) {
      connectPort(port, message);
      return;
    }

    const state = connections.get(port);
    if (!state) throw new Error('port has no active connection');
    if (message.generation !== state.generation) throw new Error('stale connection generation');

    if (message.type === MESSAGE_TYPES.CLIENT_EMIT) {
      handleClientEmit(state, message);
    } else if (message.type === MESSAGE_TYPES.ACK && message.direction === 'server') {
      const acknowledge = state.pendingServerAcks.get(message.ackId);
      if (!acknowledge) return;
      state.pendingServerAcks.delete(message.ackId);
      acknowledge(...message.args);
    } else if (message.type === MESSAGE_TYPES.DISCONNECT) {
      disconnectState(state, message.reason);
    } else {
      throw new Error(`unexpected ${message.type} from page`);
    }
  } catch (error) {
    post(port, MESSAGE_TYPES.BRIDGE_ERROR, { error: errorMessage(error) });
  }
}

globalThis.addEventListener('connect', (event) => {
  const [port] = event.ports;
  if (!port) return;
  port.addEventListener('message', (message) => handleMessage(port, message.data));
  port.addEventListener('messageerror', () => {
    post(port, MESSAGE_TYPES.BRIDGE_ERROR, { error: 'message could not be cloned' });
  });
  // Pages primarily clean up through pagehide -> DISCONNECT. Chromium does not
  // guarantee MessagePort close events, so this listener is only a fallback.
  port.addEventListener('close', () => {
    const state = connections.get(port);
    if (state) disconnectState(state, 'port closed', false);
  });
  port.start();
});
