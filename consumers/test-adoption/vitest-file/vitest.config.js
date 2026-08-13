import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['vitest-file/**/*.test.js'],
  },
});
