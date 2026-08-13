import { Server, type DefaultEventsMap, type ServerSocketContract } from 'smocket';

interface ClientToServerEvents {
  join: (room: string) => void;
}

interface ServerToClientEvents {
  ready: (message: string) => void;
}

interface SocketData {
  userId: string;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(
  'http://localhost:3012',
);

io.on('connection', (socket) => {
  const typed: ServerSocketContract<
    ClientToServerEvents,
    ServerToClientEvents,
    DefaultEventsMap,
    SocketData
  > = socket;
  typed.data.userId = 'alice';
  typed.on('join', (room) => typed.emit('ready', room));
});

await io.close();
