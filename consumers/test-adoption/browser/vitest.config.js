import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const clientTarget = process.env.SMOCKET_CLIENT_TARGET ?? 'smocket';

export default defineConfig({
  resolve: {
    alias: {
      'socket.io-client': clientTarget,
    },
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
      screenshotFailures: false,
    },
  },
});
