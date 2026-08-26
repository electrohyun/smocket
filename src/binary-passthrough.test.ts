import { expect, it } from 'vitest';
import { Server } from './mock-server';
import { receive } from './test-events';

it('keeps binary-containing direct packets on the existing in-memory path in both directions', async () => {
  const io = new Server('http://binary-passthrough.test');
  const client = io.connect();
  const socket = await io.nextConnection();
  const values = [
    new ArrayBuffer(1),
    new Uint8Array([1]),
    new DataView(new ArrayBuffer(1)),
    new Blob(['value']),
    { nested: new ArrayBuffer(1) },
    { toJSON: () => new Uint8Array([2]) },
  ];

  try {
    for (const [index, value] of values.entries()) {
      const serverEvent = `server-binary-${index}`;
      const serverReceived = receive(client, serverEvent);

      socket.emit(serverEvent, value);
      await expect(serverReceived).resolves.toBe(value);

      const clientEvent = `client-binary-${index}`;
      const clientReceived = new Promise<unknown>((resolve) => {
        socket.once(clientEvent, resolve);
      });

      client.emit(clientEvent, value);
      await expect(clientReceived).resolves.toBe(value);
    }
  } finally {
    client.disconnect();
    await io.close();
  }
});

it('keeps binary-containing acknowledgement payloads on the existing in-memory path', async () => {
  const io = new Server('http://binary-ack-passthrough.test');
  const client = io.connect();
  const socket = await io.nextConnection();
  const clientRequest = { nested: new Uint8Array([1]) };
  const serverAnswer = new ArrayBuffer(1);
  const serverRequest = new Blob(['request']);
  const clientAnswer = new DataView(new ArrayBuffer(1));

  try {
    socket.on('client-request', (value, ack) => {
      expect(value).toBe(clientRequest);
      ack(serverAnswer);
    });
    client.on('server-request', (value, ack) => {
      expect(value).toBe(serverRequest);
      ack(clientAnswer);
    });

    await expect(client.emitWithAck('client-request', clientRequest)).resolves.toBe(serverAnswer);
    await expect(socket.emitWithAck('server-request', serverRequest)).resolves.toBe(clientAnswer);
  } finally {
    client.disconnect();
    await io.close();
  }
});
