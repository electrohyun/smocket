import { Server } from '../../src/mock-server';
import { attachSharedWorker } from '../../src/shared-worker-host';

interface ConnectEvent extends Event {
  readonly ports: MessagePort[];
}

interface WorkerScope {
  addEventListener(type: 'connect', listener: (event: ConnectEvent) => void): void;
}

interface Player {
  readonly label: string;
  readonly room: string;
}

const io = new Server('http://shared-worker-lifecycle.test');
const players = new Map<string, Player>();

io.on('connection', (socket) => {
  const label = String(socket.handshake.auth.label);

  socket.on('join', async (room: string, acknowledge: (result: unknown) => void) => {
    await socket.join(room);
    players.set(socket.id, { label, room });
    acknowledge({ label, room });
  });

  socket.on('ordered', (value: number) => {
    const player = players.get(socket.id);
    if (player) socket.to(player.room).emit('ordered', value);
  });

  socket.on('marker', (token: string) => {
    const player = players.get(socket.id);
    if (player) io.to(player.room).emit('marker', token);
  });

  socket.on('hold-client-ack', () => undefined);
  socket.on('request-server-ack', (token: string) => {
    socket.emit('server-pending', token, () => undefined);
  });

  socket.on('inspect', (room: string, acknowledge: (result: unknown) => void) => {
    const namespace = io.of('/');
    acknowledge({
      players: players.size,
      roomMembers: namespace.adapter.rooms.get(room)?.size ?? 0,
      sockets: namespace.sockets.size,
    });
  });

  socket.on('disconnecting', () => {
    const player = players.get(socket.id);
    if (!player) return;
    players.delete(socket.id);
    socket.to(player.room).emit('player-left', { label: player.label });
  });
});

(globalThis as unknown as WorkerScope).addEventListener('connect', (event) => {
  const port = event.ports[0];
  if (port) attachSharedWorker(io, port);
});
