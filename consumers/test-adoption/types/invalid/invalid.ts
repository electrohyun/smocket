import { Server, type Socket } from 'smocket';

interface ClientToServerEvents {
  join: (room: string) => void;
}

interface ServerToClientEvents {
  ready: (message: string) => void;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>('http://localhost:3014');

io.on('connection', (socket) => {
  const typed: Socket<ClientToServerEvents, ServerToClientEvents> = socket;
  // @ts-expect-error Server sockets listen to the client-to-server event map.
  typed.on('ready', () => {});
  // @ts-expect-error Server sockets emit the server-to-client event map.
  typed.emit('join', 'wrong-direction');
});
