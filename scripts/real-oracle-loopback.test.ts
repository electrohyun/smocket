import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { listenRealOracle, REAL_ORACLE_HOST } from '../src/setup-real-server';

describe('real Socket.IO oracle listener', () => {
  it('binds its ephemeral server to IPv4 loopback', async () => {
    const server = createServer();
    try {
      const address = await listenRealOracle(server);

      expect(address.address).toBe(REAL_ORACLE_HOST);
      expect(address.family).toBe('IPv4');
      expect(address.port).toBeGreaterThan(0);
    } finally {
      if (server.listening) {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }
  });
});
