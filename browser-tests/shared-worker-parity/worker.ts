import { Server } from '../../src/mock-server';
import { attachSharedWorker } from '../../src/shared-worker-host';
import { registerParityLobby, type LobbyServer } from './application';

interface ConnectEvent extends Event {
  readonly ports: MessagePort[];
}

interface WorkerScope {
  addEventListener(type: 'connect', listener: (event: ConnectEvent) => void): void;
}

const io = new Server('http://shared-worker-parity.test');
registerParityLobby(io as unknown as LobbyServer);

(globalThis as unknown as WorkerScope).addEventListener('connect', (event) => {
  const port = event.ports[0];
  if (port) attachSharedWorker(io, port);
});
