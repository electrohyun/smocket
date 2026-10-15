/** Compile-only checks retain the real Buffer type through package declarations. */
import { Buffer } from 'node:buffer';
import WebSocket from 'smocket/ws';

const client = new WebSocket('ws://localhost:3000');
client.send(Buffer.from('hello'));
client.close(1000, Buffer.from('done'));

client.on('message', (data) => {
  if (!(data instanceof ArrayBuffer)) {
    const buffer: Buffer = data;
    console.log(buffer.readUInt32BE(0), buffer.toString('utf8'));
  }
});
client.on('close', (code, reason) => {
  const buffer: Buffer = reason;
  console.log(code, buffer.readUInt32BE(0));
});
client.onmessage = (event) => {
  if (typeof event.data !== 'string' && !(event.data instanceof ArrayBuffer)) {
    const buffer: Buffer = event.data;
    console.log(buffer.readUInt32BE(0));
  }
};
