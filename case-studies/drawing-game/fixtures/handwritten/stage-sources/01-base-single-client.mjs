export function createBaseFake(response) {
  const clientListeners = new Map();
  const serverListeners = new Map();

  const serverSocket = {
    on(event, listener) {
      serverListeners.set(event, listener);
      return serverSocket;
    },
    emit(event, value) {
      clientListeners.get(event)?.(value);
      return true;
    },
  };
  const clientSocket = {
    on(event, listener) {
      clientListeners.set(event, listener);
      return clientSocket;
    },
    emit(event, value) {
      serverListeners.get(event)?.(value);
      return clientSocket;
    },
  };

  serverSocket.on('request', () => serverSocket.emit('response', response));
  return { clientSocket, serverSocket };
}
