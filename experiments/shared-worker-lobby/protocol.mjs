export const PROTOCOL_VERSION = 1;

export const MESSAGE_TYPES = Object.freeze({
  CONNECT: 'CONNECT',
  CONNECTED: 'CONNECTED',
  CONNECT_ERROR: 'CONNECT_ERROR',
  CLIENT_EMIT: 'CLIENT_EMIT',
  SERVER_EVENT: 'SERVER_EVENT',
  ACK: 'ACK',
  DISCONNECT: 'DISCONNECT',
  DISCONNECTED: 'DISCONNECTED',
  BRIDGE_ERROR: 'BRIDGE_ERROR',
});

const KNOWN_TYPES = new Set(Object.values(MESSAGE_TYPES));

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(message, key) {
  if (typeof message[key] !== 'string' || message[key].length === 0) {
    throw new TypeError(`${message.type}.${key} must be a non-empty string`);
  }
}

function requireGeneration(message) {
  if (!Number.isSafeInteger(message.generation) || message.generation < 1) {
    throw new TypeError(`${message.type}.generation must be a positive integer`);
  }
}

function requireArgs(message) {
  if (!Array.isArray(message.args)) {
    throw new TypeError(`${message.type}.args must be an array`);
  }
}

/** Validate the experiment protocol at both sides of the MessagePort boundary. */
export function readProtocolMessage(value) {
  if (!isRecord(value)) throw new TypeError('bridge message must be an object');
  if (value.version !== PROTOCOL_VERSION) {
    throw new TypeError(`unsupported bridge protocol version: ${String(value.version)}`);
  }
  requireString(value, 'type');
  if (!KNOWN_TYPES.has(value.type)) throw new TypeError(`unknown bridge message: ${value.type}`);

  switch (value.type) {
    case MESSAGE_TYPES.CONNECT:
      requireString(value, 'requestId');
      requireString(value, 'url');
      if (!isRecord(value.auth)) throw new TypeError('CONNECT.auth must be an object');
      break;
    case MESSAGE_TYPES.CONNECTED:
      requireString(value, 'requestId');
      requireGeneration(value);
      requireString(value, 'id');
      requireString(value, 'workerId');
      break;
    case MESSAGE_TYPES.CONNECT_ERROR:
      requireString(value, 'requestId');
      requireString(value, 'error');
      break;
    case MESSAGE_TYPES.CLIENT_EMIT:
    case MESSAGE_TYPES.SERVER_EVENT:
      requireGeneration(value);
      requireString(value, 'event');
      requireArgs(value);
      if (value.ackId !== undefined) requireString(value, 'ackId');
      break;
    case MESSAGE_TYPES.ACK:
      requireGeneration(value);
      requireString(value, 'ackId');
      requireArgs(value);
      if (value.direction !== 'client' && value.direction !== 'server') {
        throw new TypeError('ACK.direction must be client or server');
      }
      break;
    case MESSAGE_TYPES.DISCONNECT:
    case MESSAGE_TYPES.DISCONNECTED:
      requireGeneration(value);
      requireString(value, 'reason');
      break;
    case MESSAGE_TYPES.BRIDGE_ERROR:
      requireString(value, 'error');
      break;
  }

  return value;
}

export function bridgeMessage(type, fields = {}) {
  return { ...fields, version: PROTOCOL_VERSION, type };
}
