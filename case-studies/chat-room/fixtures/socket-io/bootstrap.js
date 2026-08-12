import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { createChatApplication } from './app.js';
import { runChatRoomScenario } from './scenario.js';

function listen(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
}

function close(io) {
  return new Promise((resolve, reject) => {
    io.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createClient(url, options) {
  const client = connect(url, {
    ...options,
    autoConnect: false,
    forceNew: true,
    reconnection: false,
  });

  return {
    client,
    activate: () => client.connect(),
  };
}

export function runScenario() {
  return runChatRoomScenario({
    createClient,
    async startApplication() {
      const httpServer = createServer();
      const io = new Server(httpServer);
      await listen(httpServer);

      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        throw new Error('Socket.IO fixture did not receive a TCP address');
      }

      const url = `http://127.0.0.1:${address.port}`;
      return createChatApplication({
        io,
        url,
        close: () => close(io),
      });
    },
  });
}
