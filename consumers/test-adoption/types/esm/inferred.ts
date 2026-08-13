import { Server } from 'smocket';

interface ClientToServerEvents {
  join: (room: string) => void;
}

interface ServerToClientEvents {
  ready: (message: string) => void;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>('http://localhost:3017');

io.on('connection', (socket) => {
  socket.on('join', (room) => socket.emit('ready', room));
});
