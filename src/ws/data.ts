import { Buffer } from 'node:buffer';

/** Preserve raw view bytes and use Node conversion rules for other inputs. */
export function messageBytes(data: unknown): Buffer {
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  const bytes: Buffer = Reflect.apply(Buffer.from, Buffer, [data]);
  return Buffer.from(bytes);
}
