import { expect, it } from 'vitest';
import { setupServer } from './setup-server';
import { receive, track } from './test-events';

const ctx = setupServer();

type TimeoutError = Error & { responses: unknown[] };

it('broadcast emitWithAck resolves responses in acknowledgement arrival order', async () => {
  const late = await ctx.connectClient();
  const early = await ctx.connectClient();
  await late.serverSocket.join('all');
  await early.serverSocket.join('all');
  late.client.on('question', (_value: unknown, ack: (response: string) => void) => {
    setTimeout(() => ack('late'), 20);
  });
  early.client.on('question', (_value: unknown, ack: (response: string) => void) => ack('early'));

  await expect(ctx.io.to('all').timeout(200).emitWithAck('question', 1)).resolves.toEqual([
    'early',
    'late',
  ]);
});

it('untimed broadcast acknowledgement collection keeps the timer race and resolves [] for nobody', async () => {
  await expect(ctx.io.to('missing').emitWithAck('question')).resolves.toEqual([]);

  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  await a.serverSocket.join('all');
  await b.serverSocket.join('all');
  a.client.on('instant', (ack: (response: string) => void) => ack('a'));
  b.client.on('instant', (ack: (response: string) => void) => ack('b'));

  const outcome = await ctx.io
    .to('all')
    .emitWithAck('instant')
    .then(
      (responses) => ({ responses: responses as string[] }),
      (error: unknown) => ({ error: error as TimeoutError }),
    );
  if ('responses' in outcome) {
    expect(outcome.responses.sort()).toEqual(['a', 'b']);
  } else {
    const timeout = outcome.error;
    expect(timeout.message).toBe('operation has timed out');
    expect(timeout.responses.every((response) => response === 'a' || response === 'b')).toBe(true);
  }
});

it('untimed broadcast acknowledgement collection times out when a recipient never acknowledges', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  client.on('silent-question', (_ack: () => void) => {
    // The selected recipient deliberately does not acknowledge.
  });

  const error = (await ctx.io
    .to(serverSocket.id)
    .emitWithAck('silent-question')
    .catch((reason: unknown) => reason)) as TimeoutError;

  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('operation has timed out');
  expect(Object.hasOwn(error, 'responses')).toBe(true);
  expect(error.responses).toEqual([]);
});

it('timeout rejection exposes partial responses and late acknowledgements mutate that array once', async () => {
  const answered = await ctx.connectClient();
  const late = await ctx.connectClient();
  await answered.serverSocket.join('all');
  await late.serverSocket.join('all');
  answered.client.on('question', (ack: (response: string) => void) => ack('answered'));

  let answerLate: ((response: string) => void) | undefined;
  late.client.on('question', (ack: (response: string) => void) => {
    answerLate = ack;
  });
  late.serverSocket.on('ack-marker', (ack: () => void) => ack());

  const pending = ctx.io.to('all').timeout(100).emitWithAck('question');
  let settlements = 0;
  void pending.then(
    () => (settlements += 1),
    () => (settlements += 1),
  );

  const error = (await pending.catch((reason: unknown) => reason)) as TimeoutError;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('operation has timed out');
  expect(Object.hasOwn(error, 'responses')).toBe(true);
  expect(error.responses).toEqual(['answered']);

  answerLate?.('late');
  await late.client.emitWithAck('ack-marker');

  expect(error.responses).toEqual(['answered', 'late']);
  expect(settlements).toBe(1);
});

it('server, namespace, room, exclusion, and socket broadcast share Promise collection', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  const c = await ctx.connectClient();
  await a.serverSocket.join('selected');
  await b.serverSocket.join(['selected', 'muted']);
  for (const [entry, response] of [
    [a, 'a'],
    [b, 'b'],
    [c, 'c'],
  ] as const) {
    entry.client.on('question', (ack: (value: string) => void) => ack(response));
  }

  const serverResponses = (await ctx.io.timeout(100).emitWithAck('question')) as string[];
  const namespaceResponses = (await ctx.io
    .of('/')
    .timeout(100)
    .emitWithAck('question')) as string[];
  expect(serverResponses.sort()).toEqual(['a', 'b', 'c']);
  expect(namespaceResponses.sort()).toEqual(['a', 'b', 'c']);
  await expect(
    ctx.io.to('selected').except('muted').timeout(100).emitWithAck('question'),
  ).resolves.toEqual(['a']);
  const socketResponses = (await a.serverSocket.broadcast
    .timeout(100)
    .emitWithAck('question')) as string[];
  expect(socketResponses.sort()).toEqual(['b', 'c']);
});

it('timeout-first and narrowing-first Promise broadcasts select the same responders', async () => {
  const responder = await ctx.connectClient();
  const silent = await ctx.connectClient();
  await responder.serverSocket.join('selected');
  await silent.serverSocket.join(['selected', 'muted']);
  responder.client.on('question', (ack: (value: string) => void) => ack('answer'));
  silent.client.on('question', () => undefined);

  await expect(
    ctx.io.timeout(100).to('selected').except('muted').emitWithAck('question'),
  ).resolves.toEqual(['answer']);
  await expect(
    ctx.io.to('selected').except('muted').timeout(100).emitWithAck('question'),
  ).resolves.toEqual(['answer']);
});

it('Promise broadcast hides its collector ack and observes each selected socket once', async () => {
  const { client, serverSocket } = await ctx.connectClient();
  const outgoing: unknown[][] = [];
  serverSocket.onAnyOutgoing((...args: unknown[]) => outgoing.push(args));
  client.on('question', (_request: unknown, ack: (value: string) => void) => ack('answer'));

  await expect(ctx.io.timeout(100).emitWithAck('question', 'request')).resolves.toEqual(['answer']);
  expect(outgoing).toEqual([['question', 'request']]);
});

it('reserved Promise broadcasts reject without outgoing observation', async () => {
  const { serverSocket } = await ctx.connectClient();
  const outgoing: string[] = [];
  serverSocket.onAnyOutgoing((event) => outgoing.push(String(event)));

  await expect(ctx.io.timeout(100).emitWithAck('disconnect')).rejects.toThrow(
    '"disconnect" is a reserved event name',
  );
  expect(outgoing).toEqual([]);
});

it('dynamic parent Promise acknowledgements resolve [] without reaching concrete children', async () => {
  const parent = ctx.io.of(/^\/tenant-/);
  const a = await ctx.connectClient({ namespace: '/tenant-a' });
  const b = await ctx.connectClient({ namespace: '/tenant-b' });
  const seenA = track(a.client, 'question');
  const seenB = track(b.client, 'question');
  a.client.on('question', (ack: (value: string) => void) => ack('a'));
  b.client.on('question', (ack: (value: string) => void) => ack('b'));

  await expect(parent.timeout(100).emitWithAck('question')).resolves.toEqual([]);

  const markers = Promise.all([receive(a.client, 'marker'), receive(b.client, 'marker')]);
  a.serverSocket.emit('marker', 'a');
  b.serverSocket.emit('marker', 'b');
  await expect(markers).resolves.toEqual(['a', 'b']);
  expect(seenA.received).toBe(false);
  expect(seenB.received).toBe(false);
});

it('Promise broadcast snapshots one request and each acknowledgement response independently', async () => {
  const a = await ctx.connectClient();
  const b = await ctx.connectClient();
  const received: Array<Record<string, number>> = [];
  const source = { value: 1 };
  a.serverSocket.onAnyOutgoing((_event, request: Record<string, number>) => {
    request.value = 9;
  });
  for (const [entry, value] of [
    [a, 1],
    [b, 2],
  ] as const) {
    entry.client.on(
      'question',
      (request: Record<string, number>, ack: (response: Record<string, number>) => void) => {
        received.push(request);
        const response: Record<string, number> = { value };
        ack(response);
        response.value = 99;
      },
    );
  }

  const pending = ctx.io.timeout(100).emitWithAck('question', source);
  source.value = 7;
  const responses = (await pending) as Array<{ value: number }>;

  expect(received).toEqual([{ value: 1 }, { value: 1 }]);
  expect(responses.sort((left, right) => left.value - right.value)).toEqual([
    { value: 1 },
    { value: 2 },
  ]);
  expect(received[0]).not.toBe(received[1]);
  expect(responses[0]).not.toBe(responses[1]);
});
