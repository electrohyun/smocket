import type { BroadcastTrace, DeliveryTimer, SmocketAdapter } from '../contract';
import { defer } from './delivery';

/**
 * The room bookkeeping for one namespace, reproducing socket.io's per-namespace
 * `socket.io-adapter`. It owns the two mirrored maps and nothing else: it mutates
 * membership and answers "which sids are in these rooms", but never delivers an
 * event. Delivery is the caller's job (see `BroadcastOperator`), which keeps the
 * adapter reusable for observation (`io.of('/').adapter`, #44) without pulling
 * the delivery path into it.
 *
 * The two maps are the same membership read from both directions, kept in step
 * by every mutator:
 * - `rooms`: room name -> the sids currently in it.
 * - `sids`:  sid -> the rooms it currently belongs to.
 *
 * It is the built-in `SmocketAdapter`, and the base a custom one extends: a
 * registered adapter typically overrides `socketsIn` to observe or narrow the
 * routing decision while reusing this membership bookkeeping (see `Server.adapter`).
 */
export class Adapter implements SmocketAdapter {
  /** room -> member sids. A room key exists only while it has at least one member. */
  readonly rooms = new Map<string, Set<string>>();
  /** sid -> the rooms it is in. The reverse index, so leaving is not a full scan. */
  readonly sids = new Map<string, Set<string>>();

  /** Record that `sid` is now in `room`, updating both directions. */
  add(sid: string, room: string): void {
    const members = this.rooms.get(room) ?? new Set<string>();
    members.add(sid);
    this.rooms.set(room, members);

    const joined = this.sids.get(sid) ?? new Set<string>();
    joined.add(room);
    this.sids.set(sid, joined);
  }

  /**
   * Record that `sid` has left `room`. When the room loses its last member the
   * key is dropped, so `rooms` never keeps empty rooms around, matching
   * socket.io-adapter.
   */
  del(sid: string, room: string): void {
    const members = this.rooms.get(room);
    if (members) {
      members.delete(sid);
      if (members.size === 0) this.rooms.delete(room);
    }
    this.sids.get(sid)?.delete(room);
  }

  /**
   * Resolve target rooms to the deduped union of their member sids. A socket in
   * several of the target rooms appears once, which is what stops `io.to(a).to(b)`
   * from delivering twice to a socket in both.
   */
  socketsIn(rooms: Iterable<string>): Set<string> {
    const sids = new Set<string>();
    for (const room of rooms) {
      const members = this.rooms.get(room);
      if (!members) continue;
      for (const sid of members) sids.add(sid);
    }
    return sids;
  }
}

/** The default `DeliveryTimer`: real `setTimeout` / `Date.now`, which fake timers can drive. */
const realTimer: DeliveryTimer = {
  schedule: (fn, ms) => {
    setTimeout(fn, ms);
  },
  now: () => Date.now(),
};

/**
 * A `SmocketAdapter` that delays what a socket's client receives by a per-sid amount (#78),
 * the mock-only affordance for interleaving events across sockets deterministically in a
 * race-condition test. It slows the client-inbound stream (server -> client) only; a socket's
 * server side still receives its client's emits on the next tick, so a delay never couples
 * the two directions. It extends the built-in `Adapter`, so routing is unchanged; it adds
 * only the delivery-scheduling hook. Register it through `io.adapter` and set delays by sid:
 *
 *   let delaying!: DelayingAdapter;
 *   io.adapter(() => (delaying = new DelayingAdapter(timer)));
 *   // ...connect sockets...
 *   delaying.setDelay(slowSid, 20);
 *
 * Note the factory runs once per namespace, so the captured `delaying` is whichever namespace
 * was created last; a test that uses more than one namespace should key its own map of them
 * rather than a single variable.
 *
 * Order within the stream is preserved (0010): deliveries drain through a per-sid FIFO queue
 * one at a time, so a just-lowered delay never lets a new event overtake one already waiting,
 * and order never rides on the timer's equal-deadline callback ordering. The scheduling goes
 * through an injected `DeliveryTimer` (default real, fake-timer-drivable), so a test never
 * waits on the wall clock. A delay applies to event
 * delivery only: an acknowledgement answer and the connect / disconnect lifecycle return on
 * the normal tick. Whole-socket removal drains pending deliveries before teardown completes.
 */
export class DelayingAdapter extends Adapter {
  private readonly delays = new Map<string, number>();
  /**
   * A per-sid FIFO queue of pending deliveries, each with the time it may fire. Only the
   * head is ever scheduled; the next is scheduled after the head runs, so order is a
   * structural property of the queue, not of the timer's callback ordering (#78).
   */
  private readonly queues = new Map<string, Array<{ deliver: () => void; fireAt: number }>>();

  constructor(private readonly timer: DeliveryTimer = realTimer) {
    super();
  }

  /**
   * Set the delivery delay for `sid` in ms; `0` (or any non-positive value) clears it,
   * dropping the entry so the sid is back on the default next-tick delivery. A non-finite
   * value (`NaN` / `Infinity`) is ignored, since it has no meaning as a delay. It applies to
   * deliveries scheduled after this call; anything already queued keeps the delay it was
   * scheduled with.
   */
  setDelay(sid: string, ms: number): void {
    if (!Number.isFinite(ms)) return;
    if (ms <= 0) this.delays.delete(sid);
    else this.delays.set(sid, ms);
  }

  scheduleDelivery(sid: string, deliver: () => void): void {
    const fireAt = this.timer.now() + (this.delays.get(sid) ?? 0);
    const queue = this.queues.get(sid);
    // A drain is already running for this sid: append and let it pick this up in order.
    if (queue) {
      queue.push({ deliver, fireAt });
      return;
    }
    this.queues.set(sid, [{ deliver, fireAt }]);
    this.pump(sid);
  }

  /**
   * Fire the head of `sid`'s queue when its time is due, then drain the next. Because only
   * the head is scheduled at a time and the next is scheduled from inside the head's run,
   * a later delivery can never dispatch before an earlier one, whatever the delays or the
   * timer's equal-deadline ordering. A head already due (delay 0, or a later delivery whose
   * fire time has passed while it waited behind another) keeps the plain next-tick `defer`,
   * so a socket the test never delayed behaves exactly as it would with the built-in adapter.
   */
  private pump(sid: string): void {
    const queue = this.queues.get(sid);
    if (!queue) return;
    const head = queue[0];
    if (!head) {
      this.queues.delete(sid);
      return;
    }
    const run = () => {
      if (this.queues.get(sid) !== queue) return;
      queue.shift();
      head.deliver();
      if (this.queues.get(sid) !== queue) return;
      this.pump(sid);
    };
    const wait = head.fireAt - this.timer.now();
    if (wait <= 0) defer(run);
    else this.timer.schedule(run, wait);
  }

  /** Drain pending deliveries in order, then release all scheduler state for this socket. */
  removeSocket(sid: string): void {
    this.delays.delete(sid);
    const queue = this.queues.get(sid);
    if (!queue) return;
    this.queues.delete(sid);
    for (const entry of queue) entry.deliver();
  }
}

/**
 * A deterministic, Smocket-only final-recipient filter. It wraps another adapter so
 * membership, custom routing, scheduling, tracing, and cleanup keep their existing
 * behavior while selected sids are removed from broadcast delivery only.
 */
export class DroppingAdapter implements SmocketAdapter {
  readonly rooms: Map<string, Set<string>>;
  readonly sids: Map<string, Set<string>>;
  private readonly dropped = new Set<string>();

  constructor(private readonly adapter: SmocketAdapter = new Adapter()) {
    this.rooms = adapter.rooms;
    this.sids = adapter.sids;
  }

  add(sid: string, room: string): void {
    this.adapter.add(sid, room);
  }

  del(sid: string, room: string): void {
    this.adapter.del(sid, room);
  }

  socketsIn(rooms: Iterable<string>): Set<string> {
    return this.adapter.socketsIn(rooms);
  }

  /** Drop or restore one currently known sid without changing its room membership. */
  setDropped(sid: string, dropped = true): void {
    if (!this.sids.has(sid)) return;
    if (dropped) this.dropped.add(sid);
    else this.dropped.delete(sid);
  }

  isDropped(sid: string): boolean {
    return this.sids.has(sid) && this.dropped.has(sid);
  }

  filterBroadcastRecipients(sids: readonly string[]): ReadonlySet<string> {
    const delegated = this.adapter.filterBroadcastRecipients?.(sids) ?? new Set(sids);
    const retained = new Set<string>();
    for (const sid of sids) {
      if (delegated.has(sid) && !this.dropped.has(sid)) retained.add(sid);
    }
    return retained;
  }

  traceBroadcast(trace: BroadcastTrace): void {
    this.adapter.traceBroadcast?.(trace);
  }

  scheduleDelivery(sid: string, deliver: () => void): void {
    if (this.adapter.scheduleDelivery) this.adapter.scheduleDelivery(sid, deliver);
    else defer(deliver);
  }

  removeSocket(sid: string): void {
    this.dropped.delete(sid);
    this.adapter.removeSocket?.(sid);
  }
}

/**
 * A payload-free recorder for final broadcast routing decisions. It wraps any
 * `SmocketAdapter`, forwarding membership, routing, scheduling, and removal while
 * retaining immutable trace snapshots until `clear` is called.
 */
export class TracingAdapter implements SmocketAdapter {
  readonly rooms: Map<string, Set<string>>;
  readonly sids: Map<string, Set<string>>;
  private readonly traces: BroadcastTrace[] = [];

  constructor(private readonly adapter: SmocketAdapter = new Adapter()) {
    this.rooms = adapter.rooms;
    this.sids = adapter.sids;
  }

  add(sid: string, room: string): void {
    this.adapter.add(sid, room);
  }

  del(sid: string, room: string): void {
    this.adapter.del(sid, room);
  }

  socketsIn(rooms: Iterable<string>): Set<string> {
    return this.adapter.socketsIn(rooms);
  }

  filterBroadcastRecipients(sids: readonly string[]): ReadonlySet<string> {
    return this.adapter.filterBroadcastRecipients?.(sids) ?? new Set(sids);
  }

  removeSocket(sid: string): void {
    this.adapter.removeSocket?.(sid);
  }

  scheduleDelivery(sid: string, deliver: () => void): void {
    if (this.adapter.scheduleDelivery) this.adapter.scheduleDelivery(sid, deliver);
    else defer(deliver);
  }

  traceBroadcast(trace: BroadcastTrace): void {
    this.traces.push(trace);
  }

  getTraces(): readonly BroadcastTrace[] {
    return Object.freeze([...this.traces]);
  }

  clear(): void {
    this.traces.length = 0;
  }
}
