import { io } from 'socket.io-client';

export function createClient(url, options) {
  const client = io(url, options);

  return { client, activate() {} };
}
