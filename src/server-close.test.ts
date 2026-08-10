import { expect, it } from 'vitest';
import { setupServer } from './setup-server';

const ctx = setupServer();

function closeWithCallback(): Promise<void> {
  return new Promise((resolve, reject) => {
    void ctx.io.close((err) => (err ? reject(err) : resolve()));
  });
}

it('close invokes its callback and reports when called again', async () => {
  await closeWithCallback();
  await expect(closeWithCallback()).rejects.toMatchObject({
    code: 'ERR_SERVER_NOT_RUNNING',
  });
});

it('close rejects a connection started immediately before it', async () => {
  const client = ctx.openClient();
  const outcome = new Promise<'connect' | 'connect_error'>((resolve) => {
    client.once('connect', () => resolve('connect'));
    client.once('connect_error', () => resolve('connect_error'));
  });

  await ctx.io.close();

  await expect(outcome).resolves.toBe('connect_error');
  expect(client.connected).toBe(false);
});

it('close disconnects every namespace with the shutdown reasons', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient({ namespace: '/game' });
  const order: string[] = [];

  first.serverSocket.once('disconnecting', (reason: string) =>
    order.push(`disconnecting:${reason}`),
  );
  first.serverSocket.once('disconnect', (reason: string) => order.push(`disconnect:${reason}`));
  const firstClientReason = new Promise<string>((resolve) =>
    first.client.once('disconnect', (reason: string) => {
      order.push(`client:${reason}`);
      resolve(reason);
    }),
  );
  const secondClientReason = new Promise<string>((resolve) =>
    second.client.once('disconnect', (reason: string) => resolve(reason)),
  );

  await ctx.io.close();

  await expect(firstClientReason).resolves.toBe('transport close');
  await expect(secondClientReason).resolves.toBe('transport close');
  expect(order).toEqual([
    'disconnecting:server shutting down',
    'disconnect:server shutting down',
    'client:transport close',
  ]);
  expect(first.client.connected).toBe(false);
  expect(second.client.connected).toBe(false);
  expect(first.serverSocket.rooms.size).toBe(0);
  expect(second.serverSocket.rooms.size).toBe(0);
});

it('close rejects a pending client emitWithAck', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  serverSocket.on('slow', () => {
    /* never acks */
  });

  const pending = client.emitWithAck('slow');
  await ctx.io.close();

  await expect(pending).rejects.toThrow('socket has been disconnected');
});

it('close leaves a pending server emitWithAck pending', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('slow', () => {
    /* never acks */
  });

  const pending = serverSocket.emitWithAck('slow');
  let state = 'pending';
  void pending.then(
    () => {
      state = 'resolved';
    },
    () => {
      state = 'rejected';
    },
  );
  await ctx.io.close();

  // close() is the marker: teardown has completed, and one more microtask lets
  // any settlement caused by that teardown update the observed state.
  await Promise.resolve();
  expect(state).toBe('pending');
});

it('close does not cancel an armed server acknowledgement timeout', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('slow', () => {
    /* never acks */
  });

  const timedOut = new Promise<unknown[]>((resolve) =>
    serverSocket.timeout(20).emit('slow', (...args: unknown[]) => resolve(args)),
  );
  await ctx.io.close();

  const args = await timedOut;
  expect(args).toHaveLength(1);
  expect(args[0]).toBeInstanceOf(Error);
  expect((args[0] as Error).message).toBe('operation has timed out');
});
