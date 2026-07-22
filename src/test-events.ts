import type { ClientSocketContract, ServerSocketContract } from './contract';

/** Resolve with the first payload the client receives for `event`. */
export function receive(client: ClientSocketContract, event: string): Promise<unknown> {
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
export function track(client: ClientSocketContract, event: string): { received: boolean } {
  const state = { received: false };
  client.on(event, () => {
    state.received = true;
  });
  return state;
}

/**
 * Watch a socket's teardown from the server side. `client.disconnect()` returns
 * long before the server has processed anything: reading the roster on the next
 * line still shows the socket in all of its rooms. Awaiting `disconnected` is
 * what makes the cleanup observable, and skipping it gives a test that passes
 * locally and races elsewhere.
 *
 * Both promises resolve with a copy of `socket.rooms` taken at that moment,
 * because the live Set is emptied in place between the two events. Call this
 * before disconnecting, so the listeners are attached in time.
 */
export function observeDisconnect(socket: ServerSocketContract): {
  disconnecting: Promise<Set<string>>;
  disconnected: Promise<Set<string>>;
} {
  return {
    disconnecting: new Promise((resolve) =>
      socket.once('disconnecting', () => resolve(new Set(socket.rooms))),
    ),
    disconnected: new Promise((resolve) =>
      socket.once('disconnect', () => resolve(new Set(socket.rooms))),
    ),
  };
}

/** Count how many times `event` arrives at the client (for dedup checks). */
export function count(client: ClientSocketContract, event: string): { count: number } {
  const state = { count: 0 };
  client.on(event, () => {
    state.count += 1;
  });
  return state;
}
