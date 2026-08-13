import { Server } from 'smocket';
import { createChatApplication } from './app.js';
import { createClient } from './client.js';
import { runChatRoomScenario } from './scenario.js';

export function runScenario({ url = 'http://localhost:3010' } = {}) {
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
