function attachForwarding(server, WebSocket, { includeSender = false } = {}) {
  server.on('connection', (sender) => {
    sender.on('message', (data, isBinary) => {
      for (const client of server.clients) {
        if ((includeSender || client !== sender) && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      }
    });
  });
}

module.exports = { attachForwarding };
