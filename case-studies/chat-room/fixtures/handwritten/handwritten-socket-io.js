const servers = new Map();
let nextSocketId = 0;

function defer(action) {
  queueMicrotask(action);
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function cloneArguments(args) {
  return structuredClone(args);
}

class Emitter {
  listeners = new Map();

  on(event, listener) {
    const registered = this.listeners.get(event) ?? [];
    registered.push(listener);
    this.listeners.set(event, registered);
    return this;
  }

  dispatch(event, ...args) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args);
    }
  }
}

class BroadcastOperator {
  constructor(server, rooms, excludedSocketIds = new Set()) {
    this.server = server;
    this.rooms = new Set(rooms);
    this.excludedSocketIds = excludedSocketIds;
  }

  emit(event, ...args) {
    const recipients = this.rooms.size === 0 ? new Set(this.server.sockets.keys()) : new Set();

    for (const room of this.rooms) {
      for (const socketId of this.server.rooms.get(room) ?? []) {
        recipients.add(socketId);
      }
    }

    for (const socketId of recipients) {
      if (this.excludedSocketIds.has(socketId)) continue;
      this.server.sockets.get(socketId)?.deliver(event, cloneArguments(args));
    }

    return true;
  }
}

class ServerSocket extends Emitter {
  constructor(id, server, client, auth) {
    super();
    this.id = id;
    this.server = server;
    this.client = client;
    this.handshake = { auth: auth ?? {} };
    this.rooms = new Set();
    this.connected = true;
  }

  join(roomOrRooms) {
    if (!this.connected) return;

    for (const room of asArray(roomOrRooms)) {
      this.rooms.add(room);
      const members = this.server.rooms.get(room) ?? new Set();
      members.add(this.id);
      this.server.rooms.set(room, members);
    }
  }

  to(roomOrRooms) {
    return new BroadcastOperator(this.server, asArray(roomOrRooms), new Set([this.id]));
  }

  receive(event, args, acknowledge) {
    this.dispatch(event, ...cloneArguments(args), acknowledge);
  }

  deliver(event, args) {
    defer(() => this.client.receive(event, args));
  }

  disconnect(reason) {
    if (!this.connected) return;

    this.dispatch('disconnecting', reason);
    this.connected = false;

    for (const room of this.rooms) {
      const members = this.server.rooms.get(room);
      members?.delete(this.id);
      if (members?.size === 0) this.server.rooms.delete(room);
    }

    this.rooms.clear();
    this.server.sockets.delete(this.id);
    this.client.finishDisconnect(reason);
    this.dispatch('disconnect', reason);
  }
}

class ClientSocket extends Emitter {
  constructor(server, auth) {
    super();
    this.server = server;
    this.auth = auth;
    this.connected = false;
    this.id = undefined;
    this.peer = undefined;
  }

  attach(peer) {
    this.peer = peer;
    this.id = peer.id;
    this.connected = true;
    this.dispatch('connect');
  }

  receive(event, args) {
    if (this.connected) this.dispatch(event, ...cloneArguments(args));
  }

  emitWithAck(event, ...args) {
    return new Promise((resolve, reject) => {
      if (!this.connected || !this.peer) {
        reject(new Error('socket is not connected'));
        return;
      }

      const peer = this.peer;
      let acknowledged = false;
      defer(() => {
        peer.receive(event, args, (...responses) => {
          if (acknowledged) return;
          acknowledged = true;
          resolve(structuredClone(responses[0]));
        });
      });
    });
  }

  disconnect() {
    this.peer?.disconnect('client namespace disconnect');
    return this;
  }

  finishDisconnect(reason) {
    if (!this.connected) return;
    this.connected = false;
    this.id = undefined;
    this.peer = undefined;
    defer(() => this.dispatch('disconnect', reason));
  }
}

export class Server extends Emitter {
  constructor(url) {
    super();
    this.url = url;
    this.sockets = new Map();
    this.rooms = new Map();
    this.closed = false;
    this.closePromise = undefined;
    servers.set(url, this);
  }

  connect(options) {
    const client = new ClientSocket(this, options?.auth);
    const id = `socket-${++nextSocketId}`;
    const serverSocket = new ServerSocket(id, this, client, options?.auth);

    defer(() => {
      if (this.closed) return;
      this.sockets.set(id, serverSocket);
      serverSocket.join(id);
      this.dispatch('connection', serverSocket);
      client.attach(serverSocket);
    });

    return client;
  }

  to(roomOrRooms) {
    return new BroadcastOperator(this, asArray(roomOrRooms));
  }

  close() {
    this.closePromise ??= Promise.resolve().then(() => {
      this.closed = true;
      servers.delete(this.url);
      for (const socket of [...this.sockets.values()]) {
        socket.disconnect('server shutting down');
      }
    });
    return this.closePromise;
  }
}

export function connect(url, options) {
  const server = servers.get(url);
  if (!server) throw new Error(`No handwritten server is registered for ${url}`);
  return server.connect(options);
}
