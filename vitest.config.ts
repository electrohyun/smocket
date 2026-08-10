import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The dual run, as two projects of one config. `vitest` with no filter runs
    // both, so running both is what the tool does rather than a convention a
    // contributor has to know, and `--project` picks one when that is wanted.
    //
    // The target reaches `setup-server` through the environment, and each
    // project names it rather than only the mock, so an ambient SMOCKET_TARGET
    // in the caller's shell cannot make `--project=real` run the mock under a
    // `real` label. Anything other than `mock` is real to the dispatcher, so
    // the value here is the label and the switch at once.
    projects: [
      { test: { name: 'real', env: { SMOCKET_TARGET: 'real' } } },
      { test: { name: 'mock', env: { SMOCKET_TARGET: 'mock' } } },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Measure the shipped library only. The test files and the test-only
      // helpers (contract, the setup-* files, test-events) are not part of
      // smocket.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.typecheck.ts',
        'src/contract.ts',
        'src/setup-real-server.ts',
        'src/setup-mock-server.ts',
        'src/setup-server.ts',
        'src/setup-server.browser.ts',
        'src/test-events.ts',
      ],
      // Gate on coverage of smocket's own code, which only the mock target
      // exercises (the real target runs socket.io, not this source), so the
      // `coverage` script runs the mock target. The floors sit a little under
      // the current numbers so a normal change does not trip them, while a real
      // drop still fails the run rather than only reporting it.
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 82,
        lines: 92,
      },
    },
  },
});
