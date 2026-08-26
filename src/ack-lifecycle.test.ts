import { expect, it } from 'vitest';
import type { ClientSocketContract } from './contract';
import { setupServer } from './setup-server';
import { observeDisconnect, receive } from './test-events';

const ctx = setupServer();

const invalidAcknowledgementCases = [
  ['BigInt', () => 1n],
  [
    'circular value',
    () => {
      const value: { self?: unknown } = {};
      value.self = value;
      return value;
    },
  ],
] as const;

async function markFreshGeneration(client: ClientSocketContract): Promise<void> {
  const nextConnection = ctx.nextConnection();
  const connected = receive(client, 'connect');
  client.connect();
  const serverSocket = await nextConnection;
  serverSocket.on('ack-marker', (ack: () => void) => ack());
  await connected;
  await client.emitWithAck('ack-marker');
}

it('drops a client-to-server ack invoked after the server Socket disconnects', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let senderCalls = 0;
  serverSocket.on('question', (ack: (value: string) => void) => {
    serverSocket.disconnect();
    ack('late');
  });
  const disconnected = receive(client, 'disconnect');

  client.emit('question', () => {
    senderCalls += 1;
  });
  await disconnected;
  await markFreshGeneration(client);

  expect(senderCalls).toBe(0);
});

it('drops a server-to-client ack invoked after the client disconnects', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let senderCalls = 0;
  client.on('question', (ack: (value: string) => void) => {
    client.disconnect();
    ack('late');
  });
  const { disconnected } = observeDisconnect(serverSocket);

  serverSocket.emit('question', () => {
    senderCalls += 1;
  });
  await disconnected;
  await markFreshGeneration(client);

  expect(senderCalls).toBe(0);
});

it('drops a server-to-client ack invoked after Server.close()', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  let senderCalls = 0;
  let closing!: Promise<void>;
  client.on('question', (ack: (value: string) => void) => {
    closing = Promise.resolve(ctx.io.close());
    ack('late');
  });
  const disconnected = receive(client, 'disconnect');

  serverSocket.emit('question', () => {
    senderCalls += 1;
  });
  await disconnected;
  await closing;

  expect(senderCalls).toBe(0);
});

it('keeps acknowledgements invoked before teardown in both directions', async () => {
  const first = await ctx.connectClient();
  first.serverSocket.on('client-question', (ack: (value: string) => void) => {
    ack('client-answer');
    first.serverSocket.disconnect();
  });
  const firstDisconnected = receive(first.client, 'disconnect');
  const clientAnswer = new Promise<string>((resolve) =>
    first.client.emit('client-question', (value: string) => resolve(value)),
  );

  const second = await ctx.connectClient();
  second.client.on('server-question', (ack: (value: string) => void) => {
    ack('server-answer');
    second.client.disconnect();
  });
  const secondDisconnected = observeDisconnect(second.serverSocket).disconnected;
  const serverAnswer = new Promise<string>((resolve) =>
    second.serverSocket.emit('server-question', (value: string) => resolve(value)),
  );

  await expect(clientAnswer).resolves.toBe('client-answer');
  await expect(serverAnswer).resolves.toBe('server-answer');
  await Promise.all([firstDisconnected, secondDisconnected]);
});

it('times out a broadcast with only the connected recipient response', async () => {
  const first = await ctx.connectClient();
  const second = await ctx.connectClient();
  first.client.on('question', (ack: (value: string) => void) => {
    first.client.disconnect();
    ack('disconnected');
  });
  second.client.on('question', (ack: (value: string) => void) => ack('connected'));

  const result = await new Promise<{ error: unknown; responses: unknown[] }>((resolve) =>
    ctx.io
      .timeout(30)
      .emit('question', (error: unknown, responses: unknown[]) => resolve({ error, responses })),
  );

  expect(result.error).toBeInstanceOf(Error);
  expect((result.error as Error).message).toBe('operation has timed out');
  expect(result.responses).toEqual(['connected']);
});

it.each(invalidAcknowledgementCases)(
  'consumes a client-generated ack when its first %s response cannot be encoded',
  async (_label, invalidValue) => {
    const { client, serverSocket } = await ctx.connectClient();
    let firstCallThrew = false;
    let senderCalls = 0;
    const marker = new Promise<void>((resolve) => serverSocket.on('ack-marker', () => resolve()));
    client.on('question', (ack: (value: unknown) => void) => {
      try {
        ack(invalidValue());
      } catch {
        firstCallThrew = true;
      }
      ack('retry');
      client.emit('ack-marker');
    });

    serverSocket.emit('question', () => {
      senderCalls += 1;
    });
    await marker;

    expect(firstCallThrew).toBe(true);
    expect(senderCalls).toBe(0);
  },
);

it.each(invalidAcknowledgementCases)(
  'keeps a server-generated ack callable after a failed %s response',
  async (_label, invalidValue) => {
    const { client, serverSocket } = await ctx.connectClient();
    let firstCallThrew = false;
    serverSocket.on('question', (ack: (value: unknown) => void) => {
      try {
        ack(invalidValue());
      } catch {
        firstCallThrew = true;
      }
      ack('retry');
    });

    const answer = new Promise<unknown>((resolve) => client.emit('question', resolve));

    await expect(answer).resolves.toBe('retry');
    expect(firstCallThrew).toBe(true);
  },
);

it.each(invalidAcknowledgementCases)(
  'does not collect a broadcast retry after a client %s response fails',
  async (_label, invalidValue) => {
    const { client } = await ctx.connectClient();
    let firstCallThrew = false;
    client.on('question', (ack: (value: unknown) => void) => {
      try {
        ack(invalidValue());
      } catch {
        firstCallThrew = true;
      }
      ack('retry');
    });

    const result = await new Promise<{ error: unknown; responses: unknown[] }>((resolve) =>
      ctx.io
        .timeout(30)
        .emit('question', (error: unknown, responses: unknown[]) => resolve({ error, responses })),
    );

    expect(firstCallThrew).toBe(true);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe('operation has timed out');
    expect(result.responses).toEqual([]);
  },
);
