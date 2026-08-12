import { Server, connect } from 'smocket';
import { createChatApplication } from './app.js';
import { runChatRoomScenario } from './scenario.js';

function createClient(url, options) {
  const client = connect(url, options);

  return {
    client,
    activate() {},
  };
}

export function runScenario() {
  const url = 'http://localhost:3000';

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
