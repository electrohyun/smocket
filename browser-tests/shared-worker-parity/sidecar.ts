import { createServer } from 'node:http';
import { Server as SocketIoServer } from 'socket.io';
import { registerParityLobby, type LobbyServer } from './application';

export interface RealSidecar {
  readonly url: string;
  close(): Promise<void>;
}

export async function startRealSidecar(): Promise<RealSidecar> {
  const httpServer = createServer();
  const io = new SocketIoServer(httpServer, { cors: { origin: true } });
  registerParityLobby(io as unknown as LobbyServer);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    throw new Error('Socket.IO parity sidecar did not receive a TCP address');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        io.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
