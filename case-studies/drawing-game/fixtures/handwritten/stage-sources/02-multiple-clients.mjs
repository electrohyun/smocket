function addListener(store, event, listener) {
  const listeners = store.get(event) ?? [];
  listeners.push(listener);
  store.set(event, listeners);
}

function dispatch(store, event, args) {
  for (const listener of store.get(event) ?? []) listener(...args);
}

function createPair(id) {
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
  return { clientSocket, serverSocket };
}

export function createMultipleClientFake() {
  const connectionListeners = [];
  let nextId = 0;
  const server = {
    on(event, listener) {
      if (event === 'connection') connectionListeners.push(listener);
      return server;
    },
  };

  return {
    server,
    connect() {
      const pair = createPair(`handwritten-${++nextId}`);
      for (const listener of connectionListeners) listener(pair.serverSocket);
      return pair.clientSocket;
    },
  };
}
