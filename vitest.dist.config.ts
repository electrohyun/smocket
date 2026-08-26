import path from 'node:path';
import { defineConfig } from 'vitest/config';

// The upper tier of the two-tier Node check: the mock target run against the
// built package instead of `src/`, so the thing a consumer installs is what the
// suite exercises. `scripts/smoke.mjs` is the lower tier and covers the exact
// version `engines.node` declares, which this config cannot reach (see ci.yml).
//
// Only public entry specifiers change. Root tests resolve through dist/index.js,
// SharedWorker facade tests resolve through dist/shared-worker.js, and internal
// protocol helpers remain source-only implementation tests.
const distDirectory = process.env.SMOCKET_DIST_DIR
  ? path.resolve(process.env.SMOCKET_DIST_DIR)
  : path.resolve(import.meta.dirname, 'dist');
const dist = path.resolve(distDirectory, 'index.js');
const sharedWorkerDist = path.resolve(distDirectory, 'shared-worker.js');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^\.\/index$/, replacement: dist },
      { find: /^\.\/mock-server$/, replacement: dist },
      { find: /^\.\/shared-worker$/, replacement: sharedWorkerDist },
    ],
  },
  test: {
    name: 'mock-dist',
    env: { SMOCKET_TARGET: 'mock' },
    include: ['src/**/*.test.ts'],
    // This run is 148 tests where `pnpm test:mock` is 174, and the 26 missing
    // ones are two separate things rather than one. Read this before concluding
    // that 148 means "the whole suite passes against dist".
    //
    // 11 of them are scripts/detect-external-imports.test.ts, which tests a
    // build script and touches no library code, so `include` above leaves it to
    // the source run rather than excluding it here.
    //
    // The other 15 are the two files below. Both import from `mock-server`
    // directly for internals that `index.ts` does not re-export, so they cannot
    // resolve against `dist/`: connect-url.test.ts needs `resetRegistry` (12
    // tests, all 12 fail against dist) and socket-id.test.ts needs
    // `toBase64Url` (3 tests, 2 fail). The exclusion is per file, so the third
    // socket-id test passes against dist and is dropped anyway.
    //
    // Widening `index.ts` to export those two would fix it and is the wrong
    // trade: it would grow the public surface for the tests' convenience, and
    // the surface freezes at v1.0.0. They stay source-only unit tests.
    exclude: ['src/connect-url.test.ts', 'src/socket-id.test.ts'],
  },
});
