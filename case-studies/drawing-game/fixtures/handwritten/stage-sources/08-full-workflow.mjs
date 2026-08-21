const origins = new Map();

function createListenerStore() {
  return { events: new Map(), any: [] };
}

function addListener(store, event, listener, once = false) {
  const listeners = store.events.get(event) ?? [];
  listeners.push({ listener, once });
  store.events.set(event, listeners);
}

function removeListener(store, event, listener) {
  const listeners = store.events.get(event) ?? [];
  store.events.set(
    event,
    listeners.filter((entry) => entry.listener !== listener),
  );
}

function dispatch(store, event, args) {
  for (const listener of [...store.any]) listener(event, ...args);
  for (const entry of [...(store.events.get(event) ?? [])]) {
    if (entry.once) removeListener(store, event, entry.listener);
    entry.listener(...args);
  }
}

function attachListenerApi(target, store) {
  return Object.assign(target, {
    on(event, listener) {
      addListener(store, event, listener);
      return target;
    },
    once(event, listener) {
      addListener(store, event, listener, true);
      return target;
    },
    off(event, listener) {
      removeListener(store, event, listener);
      return target;
    },
    onAny(listener) {
      store.any.push(listener);
      return target;
    },
  });
}

function createBroadcast(state, target, senderId) {
  return {
    emit(event, ...args) {
      const ids = state.pairs.has(target) ? [target] : (state.rooms.get(target) ?? []);
      for (const id of ids) {
        const pair = state.pairs.get(id);
        if (pair && id !== senderId) dispatch(pair.clientListeners, event, args);
      }
      return true;
    },
  };
}

function disconnectPair(state, pair, reason) {
  if (!state.pairs.has(pair.id)) return;
  const wasConnected = pair.client.connected || pair.serverSocket.connected;
  pair.client.connected = false;
  pair.serverSocket.connected = false;
  state.pairs.delete(pair.id);
  for (const [room, members] of state.rooms) {
    members.delete(pair.id);
    if (members.size === 0) state.rooms.delete(room);
  }
  if (!wasConnected) return;
  dispatch(pair.serverListeners, 'disconnect', [reason]);
  dispatch(pair.clientListeners, 'disconnect', [reason]);
}

function createPair(state, auth) {
  const id = `handwritten-${++state.nextId}`;
  const clientListeners = createListenerStore();
  const serverListeners = createListenerStore();
  const pair = { id, clientListeners, serverListeners };

  const client = attachListenerApi(
    {
      id,
      connected: false,
      emit(event, ...args) {
        dispatch(serverListeners, event, args);
        return client;
      },
      disconnect() {
        disconnectPair(state, pair, 'client namespace disconnect');
        return client;
      },
    },
    clientListeners,
  );
  const serverSocket = attachListenerApi(
    {
      id,
      connected: false,
      handshake: { auth: { ...auth } },
      emit(event, ...args) {
        dispatch(clientListeners, event, args);
        return true;
      },
      async join(room) {
        const members = state.rooms.get(room) ?? new Set();
        members.add(id);
        state.rooms.set(room, members);
      },
      to(target) {
        return createBroadcast(state, target, id);
      },
      disconnect() {
        disconnectPair(state, pair, 'server namespace disconnect');
        return serverSocket;
      },
    },
    serverListeners,
  );

  Object.assign(pair, { client, serverSocket });
  state.pairs.set(id, pair);
  queueMicrotask(() => {
    if (!state.pairs.has(id)) return;
    serverSocket.connected = true;
    dispatch(state.serverListeners, 'connection', [serverSocket]);
    if (!state.pairs.has(id)) return;
    client.connected = true;
    dispatch(clientListeners, 'connect', []);
  });
  return client;
}

export class Server {
  constructor(origin) {
    if (origins.has(origin)) throw new Error(`A handwritten server already owns ${origin}`);
    this.state = {
      origin,
      nextId: 0,
      pairs: new Map(),
      rooms: new Map(),
      serverListeners: createListenerStore(),
    };
    origins.set(origin, this.state);
  }

  on(event, listener) {
    addListener(this.state.serverListeners, event, listener);
    return this;
  }

  emit(event, ...args) {
    for (const pair of this.state.pairs.values()) {
      dispatch(pair.clientListeners, event, args);
    }
    return true;
  }

  to(target) {
    return createBroadcast(this.state, target);
  }

  async close() {
    for (const pair of [...this.state.pairs.values()]) {
      disconnectPair(this.state, pair, 'server shutting down');
    }
    this.state.rooms.clear();
    origins.delete(this.state.origin);
  }
}

export function io(origin, options = {}) {
  const state = origins.get(origin);
  if (!state) throw new Error(`No handwritten server is listening at ${origin}`);
  return createPair(state, options.auth ?? {});
}
