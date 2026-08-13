import { Server, type ServerSocketContract } from 'smocket';

interface ClientToServerEvents {
  save: (id: number) => void;
}

interface ServerToClientEvents {
  saved: (id: number) => void;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents>('http://localhost:3013');

io.on('connection', (socket) => {
  const typed: ServerSocketContract<ClientToServerEvents, ServerToClientEvents> = socket;
  typed.on('save', (id) => typed.emit('saved', id));
});

void io.close();
