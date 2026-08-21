function addListener(store, event, listener) {
  const listeners = store.get(event) ?? [];
  listeners.push(listener);
  store.set(event, listeners);
}

function dispatch(store, event, args) {
  for (const listener of store.get(event) ?? []) listener(...args);
}

export function createSenderExclusionFake() {
  const connectionListeners = [];
  const pairs = new Map();
  const rooms = new Map();
  let nextId = 0;

  function createBroadcast(room, senderId) {
    return {
      emit(event, ...args) {
        for (const id of rooms.get(room) ?? []) {
          if (id !== senderId) dispatch(pairs.get(id).clientListeners, event, args);
        }
        return true;
      },
    };
  }

  const server = {
    on(event, listener) {
      if (event === 'connection') connectionListeners.push(listener);
      return server;
    },
    to(room) {
      return createBroadcast(room);
    },
  };

  return {
    server,
    connect() {
      const id = `handwritten-${++nextId}`;
      const clientListeners = new Map();
      const serverListeners = new Map();
      const serverSocket = {
        id,
        on(event, listener) {
          addListener(serverListeners, event, listener);
          return serverSocket;
        },
        emit(event, ...args) {
          dispatch(clientListeners, event, args);
          return true;
        },
        async join(room) {
          const members = rooms.get(room) ?? new Set();
          members.add(id);
          rooms.set(room, members);
        },
        to(room) {
          return createBroadcast(room, id);
        },
      };
      const clientSocket = {
        id,
        connected: true,
        on(event, listener) {
          addListener(clientListeners, event, listener);
          return clientSocket;
        },
        emit(event, value) {
          dispatch(serverListeners, event, [value]);
          return clientSocket;
        },
      };
      pairs.set(id, { clientListeners, serverSocket });
      for (const listener of connectionListeners) listener(serverSocket);
      return clientSocket;
    },
  };
}
