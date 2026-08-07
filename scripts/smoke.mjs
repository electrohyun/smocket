// The lower tier of the two-tier Node check. It runs the built package on the
// exact version `engines.node` declares, which no other job can do: vitest 4
// pulls in rolldown, and rolldown needs a `util.styleText` that Node 20 only
// grew mid-line, so the suite cannot start on 20.0.0 at all. Importing the
// module would prove only that it loads, so this drives one delivery instead:
// a join, a room broadcast, and the sender's own exclusion from it.
//
// Zero dependencies on purpose. `node:assert` and `dist/` are the whole import
// list, so whatever Node can run the package can run this.
import assert from 'node:assert/strict';
import { connect, Server } from '../dist/index.js';

const io = new Server('http://localhost');

io.on('connection', (socket) => {
  socket.on('join', (room) => {
    socket.join(room);
    socket.to(room).emit('ping', socket.id);
  });
  socket.on('marker', () => socket.emit('marker'));
});

const a = connect('http://localhost');
const b = connect('http://localhost');

const heard = [];
a.on('ping', (id) => heard.push(id));

a.emit('join', 'room');
b.emit('join', 'room');

// The marker pattern from src/test-events.ts, which this file cannot import
// (it is TypeScript, and a dependency besides). A timeout would assert
// non-receipt by waiting; the marker asserts it by ordering. Once `a` has its
// marker back, `a`'s own broadcast would already have arrived if it were coming.
await new Promise((resolve) => {
  a.once('marker', resolve);
  a.emit('marker');
});

// `a` joined to an empty room, so its own broadcast reached nobody, and it is
// excluded from the one it would otherwise hear. `b` joined second and found
// `a` there. So exactly one ping, carrying `b`'s id.
assert.deepEqual(heard, [b.id]);

console.log(`smoke ok on node ${process.version}`);
