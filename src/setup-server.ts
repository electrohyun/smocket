import { setupMockServer } from './setup-mock-server';
import { setupRealServer } from './setup-real-server';

/**
 * The target the test suite runs against. `SMOCKET_TARGET=mock` selects
 * smocket; anything else (including unset) stays on the real socket.io server.
 * Each vitest project in `vitest.config.ts` sets the value, so the fallback is
 * what makes a stray run outside those projects land on real socket.io rather
 * than silently on the mock. Both sides return the same `ServerContext`, so
 * selecting one is a single import swap in the test files, and the test bodies
 * never change.
 */
export const setupServer =
  process.env.SMOCKET_TARGET === 'mock' ? setupMockServer : setupRealServer;
