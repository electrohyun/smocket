export const SHARED_WORKER_PROTOCOL_VERSION = 1 as const;

export const SHARED_WORKER_MESSAGE_TYPES = Object.freeze({
  connect: 'CONNECT',
  connected: 'CONNECTED',
  connectError: 'CONNECT_ERROR',
  clientEvent: 'CLIENT_EVENT',
  serverEvent: 'SERVER_EVENT',
  acknowledgement: 'ACK',
  disconnect: 'DISCONNECT',
  disconnected: 'DISCONNECTED',
  bridgeError: 'BRIDGE_ERROR',
} as const);

interface SharedWorkerMessageEnvelope {
  readonly version: typeof SHARED_WORKER_PROTOCOL_VERSION;
}

export interface SharedWorkerConnectMessage extends SharedWorkerMessageEnvelope {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.connect;
  readonly requestId: string;
  readonly url: string;
  readonly auth: Record<string, unknown>;
}

interface SharedWorkerConnectionMessage extends SharedWorkerMessageEnvelope {
  readonly requestId: string;
  readonly generation: number;
}

export interface SharedWorkerConnectedMessage extends SharedWorkerConnectionMessage {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.connected;
  readonly id: string;
}

export interface SharedWorkerConnectErrorMessage extends SharedWorkerConnectionMessage {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.connectError;
  readonly error: string;
}

interface SharedWorkerEventMessage extends SharedWorkerMessageEnvelope {
  readonly generation: number;
  readonly event: string;
  readonly args: unknown[];
  readonly ackId?: string;
}

export interface SharedWorkerClientEventMessage extends SharedWorkerEventMessage {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.clientEvent;
}

export interface SharedWorkerServerEventMessage extends SharedWorkerEventMessage {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.serverEvent;
}

interface SharedWorkerAcknowledgementMessage extends SharedWorkerMessageEnvelope {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.acknowledgement;
  readonly generation: number;
  readonly ackId: string;
  readonly args: unknown[];
}

/** An acknowledgement sent by the host to settle a page-originated event. */
export interface SharedWorkerClientAcknowledgementMessage extends SharedWorkerAcknowledgementMessage {
  readonly direction: 'client';
}

/** An acknowledgement sent by the page to settle a worker-originated event. */
export interface SharedWorkerServerAcknowledgementMessage extends SharedWorkerAcknowledgementMessage {
  readonly direction: 'server';
}

export interface SharedWorkerDisconnectMessage extends SharedWorkerConnectionMessage {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.disconnect;
  readonly reason: string;
}

export interface SharedWorkerDisconnectedMessage extends SharedWorkerConnectionMessage {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.disconnected;
  readonly reason: string;
}

export interface SharedWorkerBridgeErrorMessage extends SharedWorkerMessageEnvelope {
  readonly type: typeof SHARED_WORKER_MESSAGE_TYPES.bridgeError;
  readonly error: string;
  readonly requestId?: string;
  readonly generation?: number;
}

export type SharedWorkerPageMessage =
  | SharedWorkerConnectMessage
  | SharedWorkerClientEventMessage
  | SharedWorkerServerAcknowledgementMessage
  | SharedWorkerDisconnectMessage;

export type SharedWorkerHostMessage =
  | SharedWorkerConnectedMessage
  | SharedWorkerConnectErrorMessage
  | SharedWorkerServerEventMessage
  | SharedWorkerClientAcknowledgementMessage
  | SharedWorkerDisconnectedMessage
  | SharedWorkerBridgeErrorMessage;

export type SharedWorkerBridgeMessage = SharedWorkerPageMessage | SharedWorkerHostMessage;

const KNOWN_MESSAGE_TYPES = new Set<string>(Object.values(SHARED_WORKER_MESSAGE_TYPES));
const PAGE_MESSAGE_TYPES = new Set<string>([
  SHARED_WORKER_MESSAGE_TYPES.connect,
  SHARED_WORKER_MESSAGE_TYPES.clientEvent,
  SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
  SHARED_WORKER_MESSAGE_TYPES.disconnect,
]);
const HOST_MESSAGE_TYPES = new Set<string>([
  SHARED_WORKER_MESSAGE_TYPES.connected,
  SHARED_WORKER_MESSAGE_TYPES.connectError,
  SHARED_WORKER_MESSAGE_TYPES.serverEvent,
  SHARED_WORKER_MESSAGE_TYPES.acknowledgement,
  SHARED_WORKER_MESSAGE_TYPES.disconnected,
  SHARED_WORKER_MESSAGE_TYPES.bridgeError,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(message: Record<string, unknown>, key: string): void {
  const value = message[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${String(message.type)}.${key} must be a non-empty string`);
  }
}

function requireGeneration(message: Record<string, unknown>): void {
  if (!Number.isSafeInteger(message.generation) || Number(message.generation) < 1) {
    throw new TypeError(`${String(message.type)}.generation must be a positive integer`);
  }
}

function requireArgs(message: Record<string, unknown>): void {
  if (!Array.isArray(message.args)) {
    throw new TypeError(`${String(message.type)}.args must be an array`);
  }
}

function requireConnection(message: Record<string, unknown>): void {
  requireNonEmptyString(message, 'requestId');
  requireGeneration(message);
}

/** Validate an unknown value before either side acts on a bridge message. */
export function readSharedWorkerBridgeMessage(value: unknown): SharedWorkerBridgeMessage {
  if (!isRecord(value)) throw new TypeError('shared-worker bridge message must be an object');
  if (value.version !== SHARED_WORKER_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported shared-worker protocol version: ${String(value.version)}`);
  }
  requireNonEmptyString(value, 'type');
  if (!KNOWN_MESSAGE_TYPES.has(String(value.type))) {
    throw new TypeError(`unknown shared-worker bridge message: ${String(value.type)}`);
  }

  switch (value.type) {
    case SHARED_WORKER_MESSAGE_TYPES.connect:
      requireNonEmptyString(value, 'requestId');
      requireNonEmptyString(value, 'url');
      if (!isRecord(value.auth)) throw new TypeError('CONNECT.auth must be an object');
      break;
    case SHARED_WORKER_MESSAGE_TYPES.connected:
      requireConnection(value);
      requireNonEmptyString(value, 'id');
      break;
    case SHARED_WORKER_MESSAGE_TYPES.connectError:
      requireConnection(value);
      requireNonEmptyString(value, 'error');
      break;
    case SHARED_WORKER_MESSAGE_TYPES.clientEvent:
    case SHARED_WORKER_MESSAGE_TYPES.serverEvent:
      requireGeneration(value);
      requireNonEmptyString(value, 'event');
      requireArgs(value);
      if (value.ackId !== undefined) requireNonEmptyString(value, 'ackId');
      break;
    case SHARED_WORKER_MESSAGE_TYPES.acknowledgement:
      requireGeneration(value);
      requireNonEmptyString(value, 'ackId');
      requireArgs(value);
      if (value.direction !== 'client' && value.direction !== 'server') {
        throw new TypeError('ACK.direction must be client or server');
      }
      break;
    case SHARED_WORKER_MESSAGE_TYPES.disconnect:
    case SHARED_WORKER_MESSAGE_TYPES.disconnected:
      requireConnection(value);
      requireNonEmptyString(value, 'reason');
      break;
    case SHARED_WORKER_MESSAGE_TYPES.bridgeError:
      requireNonEmptyString(value, 'error');
      if (value.requestId !== undefined) requireNonEmptyString(value, 'requestId');
      if (value.generation !== undefined) requireGeneration(value);
      break;
  }

  return value as unknown as SharedWorkerBridgeMessage;
}

/** Validate and narrow a message received by the worker host. */
export function readSharedWorkerPageMessage(value: unknown): SharedWorkerPageMessage {
  const message = readSharedWorkerBridgeMessage(value);
  if (!PAGE_MESSAGE_TYPES.has(message.type)) {
    throw new TypeError(`unexpected ${message.type} from shared-worker page`);
  }
  if (
    message.type === SHARED_WORKER_MESSAGE_TYPES.acknowledgement &&
    message.direction !== 'server'
  ) {
    throw new TypeError('the page may only acknowledge server events');
  }
  return message as SharedWorkerPageMessage;
}

/** Validate and narrow a message received by the page facade. */
export function readSharedWorkerHostMessage(value: unknown): SharedWorkerHostMessage {
  const message = readSharedWorkerBridgeMessage(value);
  if (!HOST_MESSAGE_TYPES.has(message.type)) {
    throw new TypeError(`unexpected ${message.type} from shared-worker host`);
  }
  if (
    message.type === SHARED_WORKER_MESSAGE_TYPES.acknowledgement &&
    message.direction !== 'client'
  ) {
    throw new TypeError('the host may only acknowledge client events');
  }
  return message as SharedWorkerHostMessage;
}
