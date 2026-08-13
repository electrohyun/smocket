import { Server } from 'smocket';

interface ClientToServerEvents {
  join: (room: string) => void;
}

interface ServerToClientEvents {
  ready: (message: string) => void;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>('http://localhost:3014');

io.on('connection', (socket) => {
  // @ts-expect-error Server sockets listen to the client-to-server event map.
  socket.on('ready', () => {});
  // @ts-expect-error Server sockets emit the server-to-client event map.
  socket.emit('join', 'wrong-direction');
});
