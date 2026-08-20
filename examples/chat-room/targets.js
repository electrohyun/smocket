import { createServer } from 'node:http';
import { Server as SocketIoServer } from 'socket.io';
import { io as connectSocketIo } from 'socket.io-client';
import { Server as SmocketServer } from 'smocket';
import { connect as connectSmocket } from 'smocket-client';
import { createChatApplication } from './app.js';

function listen(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
}

function closeSocketIo(io) {
  return new Promise((resolve, reject) => {
    io.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const socketIo = {
  id: 'socket.io',
  createClient(url, options) {
    const client = connectSocketIo(url, {
      ...options,
      autoConnect: false,
      forceNew: true,
      reconnection: false,
    });

    return { client, activate: () => client.connect() };
  },
  async startApplication() {
    const httpServer = createServer();
    const io = new SocketIoServer(httpServer);
    await listen(httpServer);

    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Socket.IO did not receive a TCP address');
    }

    const url = `http://127.0.0.1:${address.port}`;
    return createChatApplication({ io, url, close: () => closeSocketIo(io) });
  },
};

const smocket = {
  id: 'smocket',
  createClient(url, options) {
    return { client: connectSmocket(url, options), activate() {} };
  },
  startApplication() {
    const url = 'http://localhost:3000';
    const io = new SmocketServer(url);
    return createChatApplication({ io, url, close: () => io.close() });
  },
};

export const targets = [socketIo, smocket];
