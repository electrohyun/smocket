import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * The browser run (#105). smocket's whole point is a frontend test suite, which runs
 * in a browser or a browser-like environment, and nothing confirmed the library
 * behaves there until #139 landed as a bug found by hand: `newId` used `node:crypto`
 * and a bundler's `Buffer` shim has no `base64url`, so no client could connect in a
 * browser at all while this suite stayed green on Node.
 *
 * This is not a second dual run. A browser page cannot host a socket.io server
 * process, so only the mock target has a counterpart here, and the question it
 * answers is whether the mock behaves in a browser the way it behaves in Node. The
 * alias below is what keeps the real target out of the bundle; see
 * `src/setup-server.browser.ts`.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^(.*)\/setup-server$/,
        replacement: fileURLToPath(new URL('./src/setup-server.browser.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'browser',
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: 'chromium' }],
      // The page hosts the test runner and nothing else, so a screenshot of a failure
      // shows an empty document. Off, so a failing run leaves no stray files behind.
      screenshotFailures: false,
    },
  },
});
