import type { ConnectedClient, ServerContext } from './contract';

/**
 * Build the `connectClients` helper for a `ServerContext`, shared by the real and
 * mock harness so the sequential-connect behaviour lives in one place instead of
 * being duplicated in each. Both targets pair each `connect` with the next
 * `connection`, so connecting concurrently would mismatch the pairs; the loop
 * therefore awaits one client at a time. Keeping the single implementation here
 * makes that a structural fact rather than a rule both setups must remember to
 * follow. See ServerContext.connectClients.
 */
export function makeConnectClients(ctx: ServerContext): ServerContext['connectClients'] {
  return async (count, options) => {
    const connected: ConnectedClient[] = [];
    for (let index = 0; index < count; index += 1) {
      connected.push(await ctx.connectClient(options));
    }
    return connected;
  };
}
