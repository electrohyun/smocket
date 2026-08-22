import { beforeEach, expect, it } from 'vitest';
import { setupServer } from '../../../src/setup-server';
import { observeDisconnect, receive } from '../../../src/test-events';
import { registerLobbyHandlers, type LobbyServer, type LobbyState } from './application';

const ctx = setupServer();

beforeEach(() => {
  registerLobbyHandlers(ctx.io as unknown as LobbyServer);
});

it('the documented lobby handlers preserve identity and lifecycle across both targets', async () => {
  const connections = [
    await ctx.connectClient({ auth: { label: 'same-label' } }),
    await ctx.connectClient({ auth: { label: 'same-label' } }),
    await ctx.connectClient({ auth: { label: 'same-label' } }),
  ];
  const [first, second, third] = connections;
  if (!first || !second || !third) throw new Error('expected three lobby connections');

  let state: LobbyState | undefined;
  for (const { client } of connections) {
    const nextState = receive(first.client, 'lobby-state');
    await expect(client.emitWithAck('ready')).resolves.toEqual({ accepted: true });
    state = (await nextState) as LobbyState;
  }

  expect(state).toEqual({
    players: connections.map(({ client }, index) => ({
      id: client.id,
      label: 'same-label',
      ready: true,
      leader: index === 0,
    })),
    canStart: true,
  });
  await expect(second.client.emitWithAck('start-game')).resolves.toEqual({ accepted: false });

  const started = connections.map(({ client }) => receive(client, 'game-started'));
  await expect(first.client.emitWithAck('start-game')).resolves.toEqual({ accepted: true });
  await expect(Promise.all(started)).resolves.toEqual([
    { by: 'same-label' },
    { by: 'same-label' },
    { by: 'same-label' },
  ]);

  const remainingStates = [first.client, second.client].map((client) =>
    receive(client, 'lobby-state'),
  );
  const { disconnected } = observeDisconnect(third.serverSocket);
  third.client.disconnect();
  await disconnected;
  const afterDeparture = (await Promise.all(remainingStates)) as LobbyState[];
  expect(afterDeparture.every((next) => next.players.length === 2)).toBe(true);
  expect(afterDeparture.every((next) => next.canStart === false)).toBe(true);
});

it('normalizes a blank label and ignores readiness after departure', async () => {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Listener>();
  const states: LobbyState[] = [];
  let connect!: (socket: unknown) => Promise<void>;
  const io = {
    on: (_event: string, listener: (socket: unknown) => Promise<void>) => {
      connect = listener;
    },
    to: () => ({
      emit: (event: string, state: LobbyState) => {
        if (event === 'lobby-state') states.push(state);
      },
    }),
  } as unknown as LobbyServer;
  registerLobbyHandlers(io);
  const socket = {
    id: 'blank-label',
    handshake: { auth: { label: '   ' } },
    join: () => undefined,
    on: (event: string, listener: Listener) => {
      listeners.set(event, listener);
      return socket;
    },
  };

  await connect(socket);
  expect(states.at(-1)?.players[0]?.label).toBe('anonymous');
  listeners.get('disconnect')?.();
  let accepted = false;
  listeners.get('ready')?.(() => {
    accepted = true;
  });

  expect(accepted).toBe(true);
  expect(states.at(-1)?.players).toEqual([]);
});
