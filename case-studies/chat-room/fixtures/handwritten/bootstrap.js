import { createChatApplication } from './app.js';
import { connect, Server } from './handwritten-socket-io.js';
import { runChatRoomScenario } from './scenario.js';

function createClient(url, options) {
  const client = connect(url, options);

  return {
    client,
    activate() {},
  };
}

export function runScenario() {
  const url = 'memory://chat-room';

  return runChatRoomScenario({
    createClient,
    startApplication() {
      const io = new Server(url);
      return createChatApplication({
        io,
        url,
        close: () => io.close(),
      });
    },
  });
}
