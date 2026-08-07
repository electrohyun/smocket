// A minimal chat room: two clients in one room, one of them speaks, and the
// other one hears it. The shortest program that shows delivery reaching someone
// other than the sender, which is the part a mock without rooms cannot do.
import { connect, Server } from 'smocket';

const url = 'http://localhost:3000';

// The server side, exactly as it is written against real socket.io. The client
// is `connect` here rather than the `io` alias, so the name `io` stays free for
// the server the way an application would use it.
const io = new Server(url);

io.on('connection', (socket) => {
  const name = socket.handshake.auth.name;

  socket.on('join', (room, ack) => {
    socket.join(room);
    // `socket.to(room)` reaches the room and skips this socket, so the joiner is
    // not told about its own arrival. The first join therefore reaches nobody,
    // the room being empty until it lands.
    socket.to(room).emit('system', `${name} joined`);
    ack();
  });

  socket.on('message', (room, text) => {
    socket.to(room).emit('message', `${name}: ${text}`);
  });
});

// Two clients, each one carrying the name the server reads off the handshake.
const alice = connect(url, { auth: { name: 'alice' } });
const bob = connect(url, { auth: { name: 'bob' } });

for (const [label, client] of [
  ['alice', alice],
  ['bob', bob],
]) {
  client.on('system', (line) => console.log(`[${label}] ${line}`));
  client.on('message', (line) => console.log(`[${label}] ${line}`));
}

// Awaiting both joins is what fixes the last line. bob has to be in the room
// before alice speaks, and without the ack the message would be queued right
// behind alice's own join and arrive while bob was still connecting.
await Promise.all([alice.emitWithAck('join', 'general'), bob.emitWithAck('join', 'general')]);

alice.emit('message', 'general', 'hello');
