import { defineConfig } from 'vitest/config';

// Label every run with the target it exercised, so a pass or a failure is never
// ambiguous about which engine produced it. `real` unless SMOCKET_TARGET asks
// for the mock, the same rule the setup-server dispatcher uses.
const target = process.env.SMOCKET_TARGET === 'mock' ? 'mock' : 'real';

export default defineConfig({
  test: {
    name: target,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Measure the shipped library only. The test files and the test-only
      // helpers (contract, the setup-* files, test-events) are not part of
      // smocket.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/contract.ts',
        'src/setup-real-server.ts',
        'src/setup-mock-server.ts',
        'src/setup-server.ts',
        'src/test-events.ts',
      ],
      // No threshold yet: the suite currently exercises real socket.io, not
      // smocket's own code, so the number is not meaningful until the
      // implementation lands. Revisit once delivery branching gets complex.
    },
  },
});
