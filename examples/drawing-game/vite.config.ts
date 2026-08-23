import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function reloadWhenHandlerChanges(): Plugin {
  return {
    name: 'drawing-game-handler-reload',
    handleHotUpdate(context) {
      if (context.file.replaceAll('\\', '/').endsWith('/src/game/game-handler.ts')) {
        context.server.ws.send({
          type: 'custom',
          event: 'drawing-game:handler-changed',
          data: { version: String(context.timestamp) },
        });
        return [];
      }
      return undefined;
    },
  };
}

export default defineConfig(({ mode }) => {
  const countdownMs = mode.startsWith('verify') ? 80 : 3000;
  return {
    plugins: [react(), reloadWhenHandlerChanges()],
    define: {
      __DRAWING_GAME_TARGET__: JSON.stringify('smocket'),
      __DRAWING_GAME_COUNTDOWN_MS__: JSON.stringify(countdownMs),
    },
    server: { host: '127.0.0.1' },
  };
});
