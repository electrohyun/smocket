import { expect, it } from 'vitest';
import { Server } from './mock-server';
import { receive } from './test-events';

it('keeps binary-containing packets on the existing in-memory path', async () => {
  const io = new Server('http://binary-passthrough.test');
  const client = io.connect();
  const socket = await io.nextConnection();
  const values = [
    new ArrayBuffer(1),
    new Uint8Array([1]),
    new Blob(['value']),
    { nested: new ArrayBuffer(1) },
    { toJSON: () => new Uint8Array([2]) },
  ];

  try {
    for (const [index, value] of values.entries()) {
      const event = `binary-${index}`;
      const received = receive(client, event);

      socket.emit(event, value);

      await expect(received).resolves.toBe(value);
    }
  } finally {
    client.disconnect();
    await io.close();
  }
});
