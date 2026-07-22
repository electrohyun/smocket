import { setupMockServer } from './setup-mock-server';
import { setupRealServer } from './setup-real-server';

/**
 * The target the test suite runs against. `SMOCKET_TARGET=mock` selects
 * smocket; anything else (including unset) stays on the real socket.io server,
 * so a bare `pnpm test` keeps working and only opts into the mock on request.
 * Both sides return the same `ServerContext`, so selecting one is a single
 * import swap in the test files, and the test bodies never change.
 */
export const setupServer =
  process.env.SMOCKET_TARGET === 'mock' ? setupMockServer : setupRealServer;
