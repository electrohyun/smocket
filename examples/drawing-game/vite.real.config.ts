import react from '@vitejs/plugin-react';
import { Server as NodeHttpServer } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { attachRealSocketIoServer } from './src/real-server.js';

function realSocketIo(countdownMs: number): Plugin {
  return {
    name: 'drawing-game-real-socket-io',
    apply: 'serve',
    configureServer(server) {
      if (!(server.httpServer instanceof NodeHttpServer)) {
        throw new Error('Vite did not create a Node HTTP server');
      }
      const close = attachRealSocketIoServer(server.httpServer, countdownMs);
      server.httpServer.once('close', close);
    },
  };
}

export default defineConfig(({ mode }) => {
  const countdownMs = mode.startsWith('verify') ? 80 : 3000;
  return {
    plugins: [react(), realSocketIo(countdownMs)],
    define: {
      __DRAWING_GAME_TARGET__: JSON.stringify('real'),
      __DRAWING_GAME_COUNTDOWN_MS__: JSON.stringify(countdownMs),
    },
    server: { host: '127.0.0.1' },
  };
});
