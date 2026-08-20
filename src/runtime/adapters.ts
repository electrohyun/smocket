import type { BroadcastTrace, DeliveryTimer, SmocketAdapter } from '../contract';
import { defer } from './delivery';

/**
 * Per-namespace membership in mirrored room and sid maps. Routing is observable through
 * this adapter (#44), while delivery remains the caller's responsibility.
 */
export class Adapter implements SmocketAdapter {
  /** room -> member sids. A room key exists only while it has at least one member. */
  readonly rooms = new Map<string, Set<string>>();
  /** sid -> the rooms it is in. The reverse index, so leaving is not a full scan. */
  readonly sids = new Map<string, Set<string>>();

  add(sid: string, room: string): void {
    const members = this.rooms.get(room) ?? new Set<string>();
    members.add(sid);
    this.rooms.set(room, members);

    const joined = this.sids.get(sid) ?? new Set<string>();
    joined.add(room);
    this.sids.set(sid, joined);
  }

  /** Drop empty room keys, matching socket.io-adapter. */
  del(sid: string, room: string): void {
    const members = this.rooms.get(room);
    if (members) {
      members.delete(sid);
      if (members.size === 0) this.rooms.delete(room);
    }
    this.sids.get(sid)?.delete(room);
  }

  /** Return a deduplicated room union so overlapping targets deliver once. */
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

const realTimer: DeliveryTimer = {
  schedule: (fn, ms) => {
    setTimeout(fn, ms);
  },
  now: () => Date.now(),
};

/**
 * Delay the server-to-client stream per sid without changing routing (#78). Per-sid FIFO
 * queues preserve 0010 regardless of delay changes or timer ordering; acknowledgements and
 * lifecycle events keep their normal timing. The injected timer supports deterministic tests.
 */
export class DelayingAdapter extends Adapter {
  private readonly delays = new Map<string, number>();
  /** Only each queue head is scheduled, making order independent of timer callback ordering. */
  private readonly queues = new Map<string, Array<{ deliver: () => void; fireAt: number }>>();

  constructor(private readonly timer: DeliveryTimer = realTimer) {
    super();
  }

  /** Non-positive values clear the delay; queued deliveries retain their scheduled time. */
  setDelay(sid: string, ms: number): void {
    if (!Number.isFinite(ms)) return;
    if (ms <= 0) this.delays.delete(sid);
    else this.delays.set(sid, ms);
  }

  scheduleDelivery(sid: string, deliver: () => void): void {
    const fireAt = this.timer.now() + (this.delays.get(sid) ?? 0);
    const queue = this.queues.get(sid);
    if (queue) {
      queue.push({ deliver, fireAt });
      return;
    }
    this.queues.set(sid, [{ deliver, fireAt }]);
    this.pump(sid);
  }

  /** Schedule one queue head at a time; already-due work still uses the shared next tick. */
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
