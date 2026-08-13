import { Server, type Socket } from 'smocket';

interface ClientToServerEvents {
  save: (id: number) => void;
}

interface ServerToClientEvents {
  saved: (id: number) => void;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>('http://localhost:3016');

io.on('connection', (socket) => {
  const typed: Socket<ClientToServerEvents, ServerToClientEvents> = socket;
  typed.on('save', (id) => typed.emit('saved', id));
});

void io.close();
