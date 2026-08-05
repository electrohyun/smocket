import { expect, it, vi } from 'vitest';
import { Server, toBase64Url } from './mock-server';

// Id generation is smocket's own, with no socket.io counterpart to read it off, so these
// run against the mock alone the way the adapter tests do. What the dual run pins is the
// id's shape (`connection.test.ts`); what these pin is the encoding behind it, which #139
// showed can break while the shape still matches.
//
// The expectations are `Buffer.from(bytes).toString('base64url')` on Node, kept here as
// literals because `Buffer` is exactly what this code no longer depends on and is absent
// in the browser run.

it('encodes bytes the way base64url does, url-safe alphabet included', () => {
  // Chosen so the standard encoding is `+/++ABEiM0RVZneImaq7`, holding both characters
  // base64url replaces. An encoder that skipped either swap would still be 20 characters.
  const bytes = new Uint8Array([
    0xfb, 0xff, 0xbe, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
  ]);

  expect(toBase64Url(bytes)).toBe('-_--ABEiM0RVZneImaq7');
});

it('strips the padding a length off a multiple of three produces', () => {
  // 15 bytes emit no padding, so nothing at the id's own length can catch a missing strip.
  // These lengths can, which is the whole reason the strip is there.
  expect(toBase64Url(new Uint8Array([0xc8]))).toBe('yA');
  expect(toBase64Url(new Uint8Array([0xc8, 0xed]))).toBe('yO0');
  expect(toBase64Url(new Uint8Array([0xc8, 0xed, 0x12]))).toBe('yO0S');
});

it('an id is 15 random bytes run through that encoder', async () => {
  // Pin the two together. A fixed byte source makes the id an exact string, so a change to
  // either the length or the encoding shows up here rather than passing the shape check.
  const bytes = [0xfb, 0xff, 0xbe, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb]; // prettier-ignore
  const getRandomValues = vi
    .spyOn(crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView | null>(target: T): T => {
      const view = target as unknown as Uint8Array;
      view.set(bytes.slice(0, view.length));
      return target;
    });
  try {
    const io = new Server('http://localhost');
    const client = io.connect();
    const serverSocket = await io.nextConnection();

    expect(client.id).toBe('-_--ABEiM0RVZneImaq7');
    expect(serverSocket.id).toBe(client.id);
    expect(getRandomValues).toHaveBeenCalled();
  } finally {
    getRandomValues.mockRestore();
  }
});
