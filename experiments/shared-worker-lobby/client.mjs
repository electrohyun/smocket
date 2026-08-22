import { MESSAGE_TYPES, bridgeMessage, readProtocolMessage } from './protocol.mjs';

function makeId(prefix, sequence) {
  return `${prefix}:${crypto.randomUUID()}:${sequence}`;
}

export class SharedWorkerLobbyClient {
  constructor({ url, label, workerUrl, workerName }) {
    this.id = undefined;
    this.workerId = undefined;
    this.connected = false;
    this.generation = undefined;
    this.listeners = new Map();
    this.anyListeners = [];
    this.pendingClientAcks = new Map();
    this.nextAck = 0;
    this.disconnectSent = false;
    this.disconnectFinished = false;
    this.pendingDisconnectReason = undefined;

    this.worker = new SharedWorker(workerUrl, { name: workerName, type: 'module' });
    this.port = this.worker.port;
    this.port.addEventListener('message', (event) => this.handleMessage(event.data));
    this.port.addEventListener('messageerror', () =>
      this.dispatch('bridge_error', ['clone error']),
    );
    this.port.start();

    this.requestId = makeId('connect', 0);
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => undefined);
    this.disconnected = new Promise((resolve) => {
      this.resolveDisconnected = resolve;
    });

    this.port.postMessage(
      bridgeMessage(MESSAGE_TYPES.CONNECT, {
        requestId: this.requestId,
        url,
        auth: { label },
      }),
    );

    globalThis.addEventListener('pagehide', () => this.disconnect('pagehide'), { once: true });
  }

  on(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  off(event, listener) {
    if (event === undefined) this.listeners.clear();
    else if (listener === undefined) this.listeners.delete(event);
    else
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((item) => item !== listener),
      );
    return this;
  }

  onAny(listener) {
    this.anyListeners.push(listener);
    return this;
  }

  emit(event, ...incomingArgs) {
    if (!this.connected || !this.generation)
      throw new Error('shared-worker client is disconnected');
    const args = [...incomingArgs];
    const acknowledgement = typeof args.at(-1) === 'function' ? args.pop() : undefined;
    let ackId;
    if (acknowledgement) {
      ackId = makeId(`client:${this.generation}`, ++this.nextAck);
      this.pendingClientAcks.set(ackId, acknowledgement);
    }
    this.port.postMessage(
      bridgeMessage(MESSAGE_TYPES.CLIENT_EMIT, {
        generation: this.generation,
        event,
        args,
        ...(ackId ? { ackId } : {}),
      }),
    );
    return this;
  }

  emitWithAck(event, ...args) {
    return new Promise((resolve) => this.emit(event, ...args, resolve));
  }

  disconnect(reason = 'io client disconnect') {
    if (this.disconnectFinished || this.disconnectSent) return this.disconnected;
    if (!this.connected || !this.generation) {
      this.pendingDisconnectReason = reason;
      return this.disconnected;
    }
    this.disconnectSent = true;
    this.port.postMessage(
      bridgeMessage(MESSAGE_TYPES.DISCONNECT, { generation: this.generation, reason }),
    );
    return this.disconnected;
  }

  snapshot() {
    return {
      id: this.id,
      workerId: this.workerId,
      connected: this.connected,
      pendingClientAcks: this.pendingClientAcks.size,
    };
  }

  dispatch(event, args) {
    for (const any of [...this.anyListeners]) any(event, ...args);
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  handleMessage(value) {
    let message;
    try {
      message = readProtocolMessage(value);
    } catch (error) {
      this.dispatch('bridge_error', [error instanceof Error ? error.message : String(error)]);
      return;
    }

    if (message.type === MESSAGE_TYPES.CONNECTED && message.requestId === this.requestId) {
      this.generation = message.generation;
      this.id = message.id;
      this.workerId = message.workerId;
      this.connected = true;
      this.resolveReady();
      this.dispatch('connect', []);
      if (this.pendingDisconnectReason) this.disconnect(this.pendingDisconnectReason);
      return;
    }
    if (message.type === MESSAGE_TYPES.CONNECT_ERROR && message.requestId === this.requestId) {
      const error = new Error(message.error);
      this.connected = false;
      this.disconnectFinished = true;
      this.pendingClientAcks.clear();
      this.rejectReady(error);
      this.resolveDisconnected('connect error');
      this.dispatch('connect_error', [error]);
      return;
    }
    if (message.type === MESSAGE_TYPES.BRIDGE_ERROR) {
      this.dispatch('bridge_error', [message.error]);
      return;
    }
    if (message.generation !== this.generation) return;

    if (message.type === MESSAGE_TYPES.SERVER_EVENT) {
      const args = [...message.args];
      if (message.ackId) {
        let answered = false;
        args.push((...ackArgs) => {
          if (answered || !this.connected) return;
          answered = true;
          this.port.postMessage(
            bridgeMessage(MESSAGE_TYPES.ACK, {
              generation: this.generation,
              direction: 'server',
              ackId: message.ackId,
              args: ackArgs,
            }),
          );
        });
      }
      this.dispatch(message.event, args);
    } else if (message.type === MESSAGE_TYPES.ACK && message.direction === 'client') {
      const acknowledge = this.pendingClientAcks.get(message.ackId);
      if (!acknowledge) return;
      this.pendingClientAcks.delete(message.ackId);
      acknowledge(...message.args);
    } else if (message.type === MESSAGE_TYPES.DISCONNECTED) {
      this.connected = false;
      this.id = undefined;
      this.generation = undefined;
      this.disconnectFinished = true;
      this.pendingDisconnectReason = undefined;
      this.pendingClientAcks.clear();
      this.resolveDisconnected(message.reason);
      this.dispatch('disconnect', [message.reason]);
    }
  }
}
