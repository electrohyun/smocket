import { expect, test } from 'vitest';
import client, { connect, io } from 'smocket-client';
import { connectSharedWorker } from 'smocket-client/shared-worker';
import { Server } from 'smocket';

function createConsumerSharedWorker(SharedWorkerConstructor = globalThis.SharedWorker) {
  if (typeof SharedWorkerConstructor !== 'function') {
    throw new Error('This development workflow requires browser SharedWorker support');
  }

  return new SharedWorkerConstructor(new URL('./shared-worker.worker.js', import.meta.url), {
    name: 'smocket-packed-consumer-v1',
    type: 'module',
  });
}

test('reports an actionable error when SharedWorker is unavailable', () => {
  expect(() => createConsumerSharedWorker(null)).toThrow(
    'This development workflow requires browser SharedWorker support',
  );
});

test('loads the facade and its peer as one browser registry', async () => {
  expect(client).toBe(io);
  expect(io).toBe(connect);

  const server = new Server('http://localhost:3278');
  const accepted = server.nextConnection('/external');
  const socket = client('http://localhost:3278/external', {
    auth: { source: 'browser-tarball' },
  });

  try {
    const serverSocket = await accepted;
    expect(socket.connected).toBe(true);
    expect(serverSocket.handshake.auth).toEqual({ source: 'browser-tarball' });
  } finally {
    await server.close();
  }
});

test('runs the packed shared-worker subpaths through the browser bundler', async () => {
  const worker = createConsumerSharedWorker();
  const socket = connectSharedWorker(worker.port, {
    url: 'http://shared-worker-consumer.test',
    auth: { source: 'browser-tarball' },
  });

  try {
    if (!socket.connected) {
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
    }

    const response = await socket.emitWithAck('round-trip', 'packed');
    expect(response).toMatchObject({ value: 'packed' });
    expect(response.socketId).toBe(socket.id);
  } finally {
    socket.disconnect();
  }
});
