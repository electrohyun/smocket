import { Buffer } from 'node:buffer';

/** Convert the selected ws inputs without encoding frames or depending on ws. */
export function messageBytes(data: unknown): Buffer {
  if (typeof data === 'string') return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  if (data instanceof ArrayBuffer || data instanceof SharedArrayBuffer) {
    return Buffer.from(new Uint8Array(data));
  }
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === 'object' && data !== null) {
    const value = data.valueOf();
    if (value !== data) return messageBytes(value);
    if (Symbol.toPrimitive in data) {
      const primitive = data[Symbol.toPrimitive];
      if (typeof primitive === 'function') return messageBytes(primitive.call(data, 'string'));
    }
  }
  throw new TypeError('The ws send value must be a string or a Buffer-compatible value');
}
