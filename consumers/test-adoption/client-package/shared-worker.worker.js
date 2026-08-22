import { Server } from 'smocket';
import { attachSharedWorker } from 'smocket/shared-worker';

const server = new Server('http://shared-worker-consumer.test');

server.on('connection', (socket) => {
  socket.on('round-trip', (value, acknowledge) => {
    acknowledge({ value, socketId: socket.id });
  });
});

globalThis.onconnect = (event) => {
  attachSharedWorker(server, event.ports[0]);
};
