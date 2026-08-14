import { expect, it } from 'vitest';
import { Adapter, DroppingAdapter, Server } from './index';

class EmptyRoutingAdapter extends Adapter {
  override socketsIn(_rooms: Iterable<string>): Set<string> {
    return new Set();
  }
}

it('management lookup ignores custom routing and delivery dropping', async () => {
  const io = new Server('http://localhost');
  const dropping = new DroppingAdapter(new EmptyRoutingAdapter());
  io.adapter(() => dropping);
  io.connect();
  const first = await io.nextConnection();
  io.connect();
  const second = await io.nextConnection();
  first.join('room');
  second.join('room');
  dropping.setDropped(second.id);

  const sockets = await io.to('room').fetchSockets();

  expect(sockets).toEqual([first, second]);
  await io.close();
});

it('bulk membership ignores custom routing and delivery dropping', async () => {
  const io = new Server('http://localhost');
  const dropping = new DroppingAdapter(new EmptyRoutingAdapter());
  io.adapter(() => dropping);
  io.connect();
  const first = await io.nextConnection();
  io.connect();
  const second = await io.nextConnection();
  first.join('room');
  second.join('room');
  dropping.setDropped(second.id);

  io.to('room').socketsJoin('managed');
  expect(first.rooms.has('managed')).toBe(true);
  expect(second.rooms.has('managed')).toBe(true);
  io.to('managed').socketsLeave('managed');
  expect(first.rooms.has('managed')).toBe(false);
  expect(second.rooms.has('managed')).toBe(false);
  await io.close();
});

it('bulk disconnect ignores custom routing and delivery dropping', async () => {
  const io = new Server('http://localhost');
  const dropping = new DroppingAdapter(new EmptyRoutingAdapter());
  io.adapter(() => dropping);
  const firstClient = io.connect();
  const first = await io.nextConnection();
  const secondClient = io.connect();
  const second = await io.nextConnection();
  first.join('room');
  second.join('room');
  dropping.setDropped(second.id);
  const firstDisconnected = new Promise<unknown>((resolve) =>
    firstClient.once('disconnect', resolve),
  );
  const secondDisconnected = new Promise<unknown>((resolve) =>
    secondClient.once('disconnect', resolve),
  );

  io.to('room').disconnectSockets();

  await expect(Promise.all([firstDisconnected, secondDisconnected])).resolves.toEqual([
    'io server disconnect',
    'io server disconnect',
  ]);
  await io.close();
});
