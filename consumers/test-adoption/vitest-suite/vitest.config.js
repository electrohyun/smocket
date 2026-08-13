import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'socket.io-client': 'smocket',
    },
  },
  test: {
    include: ['vitest-suite/**/*.test.js'],
  },
});
