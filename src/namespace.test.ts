import { expect, it } from 'vitest';
import { setupRealServer } from './setup-real-server';
import { receive, track } from './test-events';

const ctx = setupRealServer();

it('io.of(nsp).emit()은 그 네임스페이스의 클라이언트에게만 간다', async () => {
  const { client: rootClient, serverSocket: rootSocket } = await ctx.connectClient();
  const { client: gameClient } = await ctx.connectClient({ namespace: '/game' });

  const gotGame = receive(gameClient, 'msg');
  const msgRoot = track(rootClient, 'msg');
  const markerRoot = receive(rootClient, 'marker');

  ctx.io.of('/game').emit('msg', 'hello');
  rootSocket.emit('marker');

  await expect(gotGame).resolves.toBe('hello');
  await markerRoot;
  expect(msgRoot.received).toBe(false);
});

it('기본 네임스페이스의 io.emit()은 다른 네임스페이스에 가지 않는다', async () => {
  const { client: rootClient } = await ctx.connectClient();
  const { client: gameClient, serverSocket: gameSocket } = await ctx.connectClient({
    namespace: '/game',
  });

  const gotRoot = receive(rootClient, 'msg');
  const msgGame = track(gameClient, 'msg');
  const markerGame = receive(gameClient, 'marker');

  // io.emit() is io.of('/').emit(), so "everyone" means everyone on `/`.
  ctx.io.emit('msg', 'hello');
  gameSocket.emit('marker');

  await expect(gotRoot).resolves.toBe('hello');
  await markerGame;
  expect(msgGame.received).toBe(false);
});

it('같은 이름의 방이라도 네임스페이스마다 별개다', async () => {
  const { client: rootClient, serverSocket: rootSocket } = await ctx.connectClient();
  const { client: gameClient, serverSocket: gameSocket } = await ctx.connectClient({
    namespace: '/game',
  });
  await rootSocket.join('room');
  await gameSocket.join('room');

  // Each namespace keeps its own adapter, so the name collides without the
  // memberships ever meeting.
  expect(ctx.io.of('/').adapter.rooms.has('room')).toBe(true);
  expect(ctx.io.of('/game').adapter.rooms.has('room')).toBe(true);

  const gotGame = receive(gameClient, 'msg');
  const msgRoot = track(rootClient, 'msg');
  const markerRoot = receive(rootClient, 'marker');

  ctx.io.of('/game').to('room').emit('msg', 'hello');
  rootSocket.emit('marker');

  await expect(gotGame).resolves.toBe('hello');
  await markerRoot;
  expect(msgRoot.received).toBe(false); // in "room" too, on the other namespace
});

it('두 네임스페이스에 붙은 클라이언트는 네임스페이스마다 다른 소켓 id를 갖는다', async () => {
  const { client: rootClient, serverSocket: rootSocket } = await ctx.connectClient();
  const { client: gameClient, serverSocket: gameSocket } = await ctx.connectClient({
    namespace: '/game',
  });

  expect(rootSocket.nsp.name).toBe('/');
  expect(gameSocket.nsp.name).toBe('/game');
  expect(gameSocket.id).not.toBe(rootSocket.id);

  // Namespaces multiplex over one connection: the two clients share a manager
  // while holding a socket, and an id, per namespace.
  expect(rootClient.io).toBe(gameClient.io);
});

it('socket.broadcast는 발신자의 네임스페이스 안에만 간다', async () => {
  const { client: rootClient, serverSocket: rootSocket } = await ctx.connectClient();
  const { client: gameClient1, serverSocket: gameSocket1 } = await ctx.connectClient({
    namespace: '/game',
  });
  const { client: gameClient2 } = await ctx.connectClient({ namespace: '/game' });

  const gotGame2 = receive(gameClient2, 'msg');
  const msgRoot = track(rootClient, 'msg');
  const msgGame1 = track(gameClient1, 'msg');
  const markerRoot = receive(rootClient, 'marker');
  const markerGame1 = receive(gameClient1, 'marker');

  gameSocket1.broadcast.emit('msg', 'hello');
  rootSocket.emit('marker');
  gameSocket1.emit('marker');

  await expect(gotGame2).resolves.toBe('hello');
  await markerRoot;
  await markerGame1;
  expect(msgRoot.received).toBe(false); // another namespace
  expect(msgGame1.received).toBe(false); // sender excluded
});
