import type { Socket as ClientSocket } from "socket.io-client";

/** Resolve with the first payload the client receives for `event`. */
export function receive(client: ClientSocket, event: string): Promise<unknown> {
  return new Promise((resolve) => {
    client.once(event, (payload) => resolve(payload));
  });
}

/**
 * Track whether `event` ever arrives. To prove a client did NOT receive a
 * message, emit it a direct `marker` afterwards: socket.io preserves per-socket
 * order, so once the marker lands, any message that was coming would already
 * have arrived.
 */
export function track(
  client: ClientSocket,
  event: string,
): { received: boolean } {
  const state = { received: false };
  client.on(event, () => {
    state.received = true;
  });
  return state;
}
