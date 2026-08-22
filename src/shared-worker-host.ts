import type { ClientSocketContract, DefaultEventsMap, EventsMap, SmocketServer } from './contract';
import {
  SHARED_WORKER_MESSAGE_TYPES,
  SHARED_WORKER_PROTOCOL_VERSION,
  readSharedWorkerPageMessage,
  type SharedWorkerBridgeErrorMessage,
  type SharedWorkerClientAcknowledgementMessage,
  type SharedWorkerClientEventMessage,
  type SharedWorkerConnectMessage,
  type SharedWorkerConnectedMessage,
  type SharedWorkerConnectErrorMessage,
  type SharedWorkerDisconnectedMessage,
  type SharedWorkerHostMessage,
  type SharedWorkerPageMessage,
  type SharedWorkerServerEventMessage,
} from './shared-worker-protocol';

interface SharedWorkerConnectionState {
  readonly requestId: string;
  readonly generation: number;
  readonly socket: ClientSocketContract;
  readonly pendingServerAcknowledgements: Map<string, (...args: unknown[]) => void>;
  readonly pendingClientAcknowledgements: Set<SharedWorkerConnectionReference>;
  nextAcknowledgement: number;
  finished: boolean;
  disconnectReason?: string;
}

interface SharedWorkerConnectionReference {
  state: SharedWorkerConnectionState | undefined;
}

export interface SharedWorkerHost {
  /** Detach this port and disconnect its active socket. Repeated calls do nothing. */
  close(reason?: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function connectionTarget(url: string): {
  namespace: string;
  query: Record<string, string> | undefined;
} {
  const base = (globalThis as { location?: { origin: string } }).location?.origin;
  const parsed = new URL(url, base);
  const query = Object.fromEntries(parsed.searchParams);
  return {
    namespace: parsed.pathname || '/',
    query: Object.keys(query).length === 0 ? undefined : query,
  };
}

/**
 * Attach one application-owned MessagePort to an existing Smocket server. The caller
 * owns the SharedWorker, server handlers, worker URL, and worker name (ADR 0038).
 */
export function attachSharedWorker<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
  ServerSideEvents extends EventsMap = DefaultEventsMap,
  SocketData = Record<string, unknown>,
>(
  server: SmocketServer<ListenEvents, EmitEvents, ServerSideEvents, SocketData>,
  port: MessagePort,
): SharedWorkerHost {
  let active: SharedWorkerConnectionState | undefined;
  let nextGeneration = 0;
  let closed = false;

  const post = (message: SharedWorkerHostMessage): boolean => {
    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      if (message.type === SHARED_WORKER_MESSAGE_TYPES.bridgeError) return false;
      const bridgeError: SharedWorkerBridgeErrorMessage = {
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
        error: `could not clone host message: ${errorMessage(error)}`,
        ...('requestId' in message ? { requestId: message.requestId } : {}),
        ...('generation' in message ? { generation: message.generation } : {}),
      };
      try {
        port.postMessage(bridgeError);
      } catch {
        // The port cannot carry even the clone-safe bridge error, so there is no peer to notify.
      }
      return false;
    }
  };

  const reportBridgeError = (error: unknown): void => {
    const bridgeError: SharedWorkerBridgeErrorMessage = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: errorMessage(error),
    };
    post(bridgeError);
  };

  const finish = (
    state: SharedWorkerConnectionState,
    reason: string,
    notify: boolean,
    disconnectSocket: boolean,
  ): void => {
    if (state.finished) return;
    state.finished = true;
    state.pendingServerAcknowledgements.clear();
    for (const reference of state.pendingClientAcknowledgements) reference.state = undefined;
    state.pendingClientAcknowledgements.clear();
    if (active === state) active = undefined;
    if (disconnectSocket) state.socket.disconnect();
    if (notify) {
      const message: SharedWorkerDisconnectedMessage = {
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.disconnected,
        requestId: state.requestId,
        generation: state.generation,
        reason,
      };
      post(message);
    }
  };

  const disconnect = (state: SharedWorkerConnectionState, reason: string, notify = true): void => {
    state.disconnectReason = reason;
    finish(state, reason, notify, true);
  };

  const acknowledgeClientEvent = (
    state: SharedWorkerConnectionState,
    ackId: string | undefined,
    args: unknown[],
  ): void => {
    if (!ackId || state.finished || active !== state) return;
    const message: SharedWorkerClientAcknowledgementMessage = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
      generation: state.generation,
      direction: 'client',
      ackId,
      args,
    };
    post(message);
  };

  const forwardServerEvent = (
    state: SharedWorkerConnectionState,
    event: string,
    incomingArgs: unknown[],
  ): void => {
    if (state.finished || active !== state) return;
    const args = [...incomingArgs];
    const candidate = args.at(-1);
    const acknowledgement =
      typeof candidate === 'function' ? (args.pop() as (...values: unknown[]) => void) : undefined;
    const ackId = acknowledgement
      ? `server:${state.generation}:${++state.nextAcknowledgement}`
      : undefined;
    if (ackId && acknowledgement) {
      state.pendingServerAcknowledgements.set(ackId, acknowledgement);
    }
    const message: SharedWorkerServerEventMessage = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.serverEvent,
      generation: state.generation,
      event,
      args,
      ...(ackId ? { ackId } : {}),
    };
    if (!post(message) && ackId) state.pendingServerAcknowledgements.delete(ackId);
  };

  const connect = (message: SharedWorkerConnectMessage): void => {
    if (active) disconnect(active, 'replaced connection');

    const generation = ++nextGeneration;
    let socket: ClientSocketContract;
    try {
      const { namespace, query } = connectionTarget(message.url);
      socket = server.connect(namespace, {
        auth: message.auth,
        ...(query ? { query } : {}),
        forceNew: true,
      }) as ClientSocketContract;
    } catch (error) {
      const failed: SharedWorkerConnectErrorMessage = {
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.connectError,
        requestId: message.requestId,
        generation,
        error: errorMessage(error),
      };
      post(failed);
      return;
    }

    const state: SharedWorkerConnectionState = {
      requestId: message.requestId,
      generation,
      socket,
      pendingServerAcknowledgements: new Map(),
      pendingClientAcknowledgements: new Set(),
      nextAcknowledgement: 0,
      finished: false,
    };
    active = state;

    socket.onAny((event: string, ...args: unknown[]) => forwardServerEvent(state, event, args));
    socket.on('connect', () => {
      if (state.finished || active !== state) {
        socket.disconnect();
        return;
      }
      const connected: SharedWorkerConnectedMessage = {
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.connected,
        requestId: state.requestId,
        generation: state.generation,
        id: socket.id as string,
      };
      if (!post(connected)) disconnect(state, 'bridge delivery failed', false);
    });
    socket.on('connect_error', (error: Error) => {
      if (state.finished || active !== state) return;
      const failed: SharedWorkerConnectErrorMessage = {
        version: SHARED_WORKER_PROTOCOL_VERSION,
        type: SHARED_WORKER_MESSAGE_TYPES.connectError,
        requestId: state.requestId,
        generation: state.generation,
        error: errorMessage(error),
      };
      post(failed);
      finish(state, 'connect error', false, false);
    });
    socket.on('disconnect', (reason: string) => {
      finish(state, state.disconnectReason ?? reason, true, false);
    });
  };

  const handleClientEvent = (
    state: SharedWorkerConnectionState,
    message: SharedWorkerClientEventMessage,
  ): void => {
    const args = [...message.args];
    const ackId = message.ackId;
    if (ackId) {
      let answered = false;
      const reference: SharedWorkerConnectionReference = { state };
      state.pendingClientAcknowledgements.add(reference);
      args.push((...acknowledgementArgs: unknown[]) => {
        if (answered) return;
        answered = true;
        const current = reference.state;
        reference.state = undefined;
        if (!current) return;
        current.pendingClientAcknowledgements.delete(reference);
        acknowledgeClientEvent(current, ackId, acknowledgementArgs);
      });
    }
    state.socket.emit(message.event, ...args);
  };

  const handleMessage = (value: unknown): void => {
    let message: SharedWorkerPageMessage;
    try {
      message = readSharedWorkerPageMessage(value);
    } catch (error) {
      reportBridgeError(error);
      return;
    }

    if (message.type === SHARED_WORKER_MESSAGE_TYPES.connect) {
      connect(message);
      return;
    }

    const state = active;
    if (!state) {
      if (message.generation <= nextGeneration) return;
      reportBridgeError(new Error('shared-worker port has no active connection'));
      return;
    }
    if (message.generation < state.generation) return;
    if (message.generation > state.generation) {
      reportBridgeError(new Error('unknown shared-worker connection generation'));
      return;
    }
    if (
      message.type === SHARED_WORKER_MESSAGE_TYPES.disconnect &&
      message.requestId !== state.requestId
    ) {
      reportBridgeError(new Error('disconnect request does not own the active connection'));
      return;
    }

    if (message.type === SHARED_WORKER_MESSAGE_TYPES.clientEvent) {
      handleClientEvent(state, message);
    } else if (message.type === SHARED_WORKER_MESSAGE_TYPES.acknowledgement) {
      const acknowledge = state.pendingServerAcknowledgements.get(message.ackId);
      if (!acknowledge) return;
      state.pendingServerAcknowledgements.delete(message.ackId);
      acknowledge(...message.args);
    } else {
      disconnect(state, message.reason);
    }
  };

  const onMessage = (event: MessageEvent<unknown>): void => handleMessage(event.data);
  const onMessageError = (): void => {
    const bridgeError: SharedWorkerBridgeErrorMessage = {
      version: SHARED_WORKER_PROTOCOL_VERSION,
      type: SHARED_WORKER_MESSAGE_TYPES.bridgeError,
      error: 'shared-worker page message could not be cloned',
    };
    post(bridgeError);
  };

  port.addEventListener('message', onMessage);
  port.addEventListener('messageerror', onMessageError);
  port.start();

  return {
    close(reason = 'shared-worker host closed'): void {
      if (closed) return;
      closed = true;
      port.removeEventListener('message', onMessage);
      port.removeEventListener('messageerror', onMessageError);
      if (active) disconnect(active, reason);
    },
  };
}
