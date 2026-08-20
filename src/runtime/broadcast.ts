import type {
  BroadcastContract,
  FetchedSocketContract,
  SmocketAdapter,
  TimeoutBroadcastContract,
} from '../contract';
import {
  asRooms,
  assertNotReservedEvent,
  defer,
  encodePayload,
  type EncodedPayload,
} from './delivery';

export interface BroadcastSocket extends FetchedSocketContract {
  readonly id: string;
  readonly rooms: Set<string>;
  isClientReady(): boolean;
  sendBroadcast(
    event: string,
    sourceArgs: unknown[],
    payload: EncodedPayload,
    ack?: (...answer: unknown[]) => void,
  ): void;
  join(room: string | string[]): Promise<void> | void;
  leave(room: string): Promise<void> | void;
  disconnect(close?: boolean): this;
}

export interface BroadcastNamespace<Socket extends BroadcastSocket> {
  readonly adapter: SmocketAdapter;
  readonly sockets: ReadonlyMap<string, Socket>;
}

/**
 * The object returned by every broadcast form: `io.emit`, `io.to`/`in`/`except`,
 * `socket.broadcast`, `socket.to`, `socket.except`. All eleven are the same one
 * formula over two sets, so they are all this one operator built with different
 * initial sets (see the `Server` / `ServerSocket` construction sites):
 *
 *   targets  = targetRooms empty ? all connected sids : union(targetRooms)
 *   excluded = union(each exceptRoom's member sids)
 *   deliver to (targets - excluded), once per socket
 *
 * Sender exclusion is not a flag: it is the sender's own id-room dropped into
 * `exceptRooms`. Because every socket auto-joins a room named after its id on
 * connect, `except {ownId}` subtracts exactly the sender. This is why
 * `socket.to(room)` excludes a sender that is itself in `room` for free: the
 * room's union includes the sender (its id-room member is itself), and the
 * `{ownId}` except then removes it.
 *
 * Every way of narrowing a broadcast — `to` / `in` / `except` / `timeout` — is on the
 * operator as well as on the entry points, so the order they are chained in does not
 * change the recipients (#137): `io.to(a).except(b)` and `io.except(b).to(a)` build the
 * same two sets. Each returns a *new* operator over the merged sets rather than narrowing
 * this one, measured against real socket.io: an operator held in a variable is a fixed
 * target, and a later chained call on it produces another operator instead of widening the
 * one already held. `to` unions in more rooms, so `io.to(a).to(b)` targets the union of
 * both, and `except` unions likewise.
 *
 * `emit` resolves both sets to sids through the adapter, then hands each surviving
 * member to that member's own `ServerSocket.emit`. It deliberately reuses the
 * per-socket send path rather than delivering itself: every event, direct or
 * broadcast, then flows through the one `defer` primitive, so the per-socket FIFO
 * order the "did NOT receive" marker proofs rely on holds for broadcast too.
 *
 * When `volatile` is set (the `.volatile` broadcast forms, 0016) the routing is
 * unchanged; the only difference is a per-recipient drop: a target whose client has
 * not yet completed its connection is skipped rather than delivered to, matching real
 * socket.io deciding volatile per recipient. Connected recipients receive it as normal.
 */
export class BroadcastOperator<Socket extends BroadcastSocket = BroadcastSocket>
  implements BroadcastContract, TimeoutBroadcastContract
{
  private readonly targetRooms: Set<string>;
  private readonly exceptRooms: Set<string>;

  constructor(
    private readonly adapter: SmocketAdapter,
    private readonly sockets: ReadonlyMap<string, Socket>,
    rooms: Iterable<string>,
    except: Iterable<string>,
    private readonly isVolatile = false,
    /** When set, `emit` with a trailing callback collects each recipient's ack (#112). */
    private readonly timeoutMs: number | undefined = undefined,
  ) {
    this.targetRooms = new Set(rooms);
    this.exceptRooms = new Set(except);
  }

  /**
   * One more narrowing of this broadcast, as a new operator (#137). The adapter, the
   * socket map, and the volatile flag are carried over untouched; only the two sets and
   * the timeout ever differ, which is why every chaining method below is one call to this.
   */
  private narrow(
    rooms: Iterable<string>,
    except: Iterable<string>,
    timeoutMs = this.timeoutMs,
  ): BroadcastOperator<Socket> {
    return new BroadcastOperator(
      this.adapter,
      this.sockets,
      rooms,
      except,
      this.isVolatile,
      timeoutMs,
    );
  }

  to(room: string | string[]): BroadcastOperator<Socket> {
    return this.narrow([...this.targetRooms, ...asRooms(room)], this.exceptRooms);
  }

  in(room: string | string[]): BroadcastOperator<Socket> {
    // `in` is a pure alias of `to` here too; delegate so the two cannot drift.
    return this.to(room);
  }

  except(room: string | string[]): BroadcastOperator<Socket> {
    return this.narrow(this.targetRooms, [...this.exceptRooms, ...asRooms(room)]);
  }

  /** Add an explicit deadline to the acknowledgement collector used by callback and Promise forms. */
  timeout(ms: number): BroadcastOperator<Socket> {
    return this.narrow(this.targetRooms, this.exceptRooms, ms);
  }

  /** Compression is transport-only here; retain immutability and every routing modifier. */
  compress(_compress: boolean): BroadcastOperator<Socket> {
    return this.narrow(this.targetRooms, this.exceptRooms);
  }

  /**
   * Return a new operator with the volatile delivery flag. The getter never mutates
   * the narrowed operator it was read from, and it carries any timeout already set.
   */
  get volatile(): BroadcastOperator<Socket> {
    return new BroadcastOperator(
      this.adapter,
      this.sockets,
      this.targetRooms,
      this.exceptRooms,
      true,
      this.timeoutMs,
    );
  }

  /**
   * Resolve this broadcast's recipients: empty target rooms means "everyone" (`io.emit` /
   * `socket.broadcast`), otherwise the deduped union of the target rooms' members, minus the
   * except rooms (the sender's id-room for the `socket.*` forms). A volatile broadcast also
   * skips a recipient still in its pre-connect window (0016).
   */
  private recipients(): { recipients: Socket[]; excluded: Set<string> } {
    const targets =
      this.targetRooms.size === 0
        ? new Set(this.sockets.keys())
        : this.adapter.socketsIn(this.targetRooms);
    const excluded = this.adapter.socketsIn(this.exceptRooms);
    const out: Socket[] = [];
    for (const sid of targets) {
      if (excluded.has(sid)) continue;
      const socket = this.sockets.get(sid);
      if (!socket) continue;
      if (this.isVolatile && !socket.isClientReady()) continue;
      out.push(socket);
    }
    if (!this.adapter.filterBroadcastRecipients) return { recipients: out, excluded };
    const orderedSids = Object.freeze(out.map((socket) => socket.id));
    const retained = this.adapter.filterBroadcastRecipients(orderedSids);
    return { recipients: out.filter((socket) => retained.has(socket.id)), excluded };
  }

  /** Select management targets from canonical Socket state, independent of delivery adapters. */
  private managementSockets(): Socket[] {
    const candidates: Socket[] = [];
    if (this.targetRooms.size === 0) {
      candidates.push(...this.sockets.values());
    } else {
      const seen = new Set<string>();
      for (const room of this.targetRooms) {
        for (const socket of this.sockets.values()) {
          if (seen.has(socket.id) || !socket.rooms.has(room)) continue;
          seen.add(socket.id);
          candidates.push(socket);
        }
      }
    }
    const out: Socket[] = [];
    for (const socket of candidates) {
      if ([...this.exceptRooms].some((room) => socket.rooms.has(room))) continue;
      out.push(socket);
    }
    return out;
  }

  fetchSockets(): Promise<Socket[]> {
    return Promise.resolve(this.managementSockets());
  }

  socketsJoin(room: string | string[]): void {
    const rooms = asRooms(room);
    for (const socket of this.managementSockets()) socket.join(rooms);
  }

  socketsLeave(room: string | string[]): void {
    const rooms = asRooms(room);
    for (const socket of this.managementSockets()) {
      for (const name of rooms) socket.leave(name);
    }
  }

  disconnectSockets(close = false): void {
    for (const socket of this.managementSockets()) socket.disconnect(close);
  }

  /** Record the one final routing snapshot before acknowledgement or delivery work begins. */
  private trace(event: string, recipients: readonly Socket[], excluded: Set<string>): void {
    if (!this.adapter.traceBroadcast) return;
    const trace = Object.freeze({
      event,
      rooms: Object.freeze([...this.targetRooms]),
      exceptRooms: Object.freeze([...this.exceptRooms]),
      excluded: Object.freeze([...excluded]),
      recipients: Object.freeze(recipients.map((socket) => socket.id)),
      volatile: this.isVolatile,
    });
    this.adapter.traceBroadcast(trace);
  }

  emit(event: string, ...args: unknown[]): boolean {
    assertNotReservedEvent(event);
    const last = args.at(-1);
    const ack = typeof last === 'function' ? (last as (...a: unknown[]) => void) : undefined;
    const data = ack ? args.slice(0, -1) : args;
    // Socket.IO encodes one broadcast packet before recipient observation, even
    // when routing resolves to nobody (0026). Each recipient decodes it separately.
    const payload = encodePayload(data);
    const { recipients, excluded } = this.recipients();
    this.trace(event, recipients, excluded);
    // A trailing callback always collects one ack per recipient. With no explicit
    // timeout, Socket.IO still arms setTimeout(undefined), so immediate acknowledgements
    // race the zero-delay timer instead of waiting indefinitely.
    if (typeof last !== 'function') {
      for (const socket of recipients) socket.sendBroadcast(event, args, payload, ack);
      return true;
    }
    this.collect(
      event,
      data,
      payload,
      last as (...a: unknown[]) => void,
      recipients,
      this.timeoutMs,
    );
    return true;
  }

  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.emit(event, ...args, (error: unknown, responses: unknown[]) => {
        if (error) {
          Object.assign(error as object, { responses });
          reject(error);
          return;
        }
        resolve(responses);
      });
    });
  }

  /**
   * Fan `event` out to `recipients` and gather their acks (#112). The callback fires once:
   * `(null, responses)` when every recipient answers before `ms`, or `(Error('operation has
   * timed out'), responses)` when the timer wins, where `responses` holds the acks that
   * arrived, in arrival order (measured on 4.7.5 and 4.8.3, not join order). A `settled`
   * flag keeps the callback single-shot. A late ack may still append to the already exposed
   * response array, matching Socket.IO's collector. No recipient resolves at once as
   * `(null, [])`.
   */
  private collect(
    event: string,
    data: unknown[],
    payload: EncodedPayload,
    callback: (...received: unknown[]) => void,
    recipients: Socket[],
    ms: number | undefined,
  ): void {
    if (recipients.length === 0) {
      defer(() => callback(null, []));
      return;
    }
    const responses: unknown[] = [];
    let settled = false;
    let remaining = recipients.length;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      callback(new Error('operation has timed out'), responses);
    }, ms);
    for (const socket of recipients) {
      const answer = (...received: unknown[]) => {
        responses.push(received[0]);
        if (settled) return;
        remaining -= 1;
        if (remaining === 0) {
          settled = true;
          clearTimeout(timer);
          callback(null, responses);
        }
      };
      socket.sendBroadcast(event, [...data, answer], payload, answer);
    }
  }
}

/** Broadcast view over the concrete children currently owned by one dynamic parent. */
export class ParentBroadcastOperator<Socket extends BroadcastSocket = BroadcastSocket>
  implements BroadcastContract, TimeoutBroadcastContract
{
  constructor(
    private readonly children: ReadonlySet<BroadcastNamespace<Socket>>,
    private readonly rooms: readonly string[] = [],
    private readonly exceptRooms: readonly string[] = [],
    private readonly timeoutMs?: number,
    private readonly isVolatile = false,
  ) {}

  to(room: string | string[]): ParentBroadcastOperator<Socket> {
    return new ParentBroadcastOperator(
      this.children,
      [...this.rooms, ...asRooms(room)],
      this.exceptRooms,
      this.timeoutMs,
      this.isVolatile,
    );
  }
  in(room: string | string[]): ParentBroadcastOperator<Socket> {
    return this.to(room);
  }
  except(room: string | string[]): ParentBroadcastOperator<Socket> {
    return new ParentBroadcastOperator(
      this.children,
      this.rooms,
      [...this.exceptRooms, ...asRooms(room)],
      this.timeoutMs,
      this.isVolatile,
    );
  }
  timeout(ms: number): ParentBroadcastOperator<Socket> {
    return new ParentBroadcastOperator(
      this.children,
      this.rooms,
      this.exceptRooms,
      ms,
      this.isVolatile,
    );
  }
  compress(_compress: boolean): ParentBroadcastOperator<Socket> {
    return new ParentBroadcastOperator(
      this.children,
      this.rooms,
      this.exceptRooms,
      this.timeoutMs,
      this.isVolatile,
    );
  }
  get volatile(): ParentBroadcastOperator<Socket> {
    return new ParentBroadcastOperator(
      this.children,
      this.rooms,
      this.exceptRooms,
      this.timeoutMs,
      true,
    );
  }
  emit(event: string, ...args: unknown[]): boolean {
    for (const child of this.children) {
      new BroadcastOperator(
        child.adapter,
        child.sockets,
        this.rooms,
        this.exceptRooms,
        this.isVolatile,
        this.timeoutMs,
      ).emit(event, ...args);
    }
    return true;
  }

  /**
   * Direct parent Promise acknowledgement broadcasts resolve `[]` without reaching
   * concrete children in both supported minors. Narrowed parent delivery stays outside
   * the broader conformance claim under 0029.
   */
  emitWithAck(event: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve) => {
      assertNotReservedEvent(event);
      void args;
      resolve([]);
    });
  }

  /** Socket.IO's narrowed parent operator sees the parent's empty local roster. */
  fetchSockets(): Promise<Socket[]> {
    return Promise.resolve([]);
  }
  socketsJoin(_room: string | string[]): void {}
  socketsLeave(_room: string | string[]): void {}
  disconnectSockets(_close = false): void {}
}
