import { Server, type DefaultEventsMap, type Socket } from 'smocket';

interface ClientToServerEvents {
  select: (id: number) => void;
}

interface ServerToClientEvents {
  selected: (id: number) => void;
}

interface SocketData {
  selectedId: number;
}

const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(
  'http://localhost:3015',
);

io.on('connection', (socket) => {
  const typed: Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData> =
    socket;
  typed.data.selectedId = 1;
  typed.on('select', (id) => typed.emit('selected', id));

  // @ts-expect-error Server sockets listen to the client-to-server event map.
  typed.on('selected', () => {});
  // @ts-expect-error Server sockets emit the server-to-client event map.
  typed.emit('select', 1);
});

void io.close();
