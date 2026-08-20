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
 * One immutable operator backs every broadcast form (#137):
 *
 *   targets  = targetRooms empty ? all connected sids : union(targetRooms)
 *   excluded = union(each exceptRoom's member sids)
 *   deliver to (targets - excluded), once per socket
 *
 * A sender is excluded through its auto-joined id-room. The adapter resolves routing,
 * while each surviving socket keeps the shared FIFO delivery path (0010). Volatile
 * delivery drops recipients whose client peer is not connected (0016).
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
    private readonly timeoutMs: number | undefined = undefined,
  ) {
    this.targetRooms = new Set(rooms);
    this.exceptRooms = new Set(except);
  }

  /** Return a new operator so narrowing never mutates a previously held target (#137). */
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
    return this.to(room);
  }

  except(room: string | string[]): BroadcastOperator<Socket> {
    return this.narrow(this.targetRooms, [...this.exceptRooms, ...asRooms(room)]);
  }

  timeout(ms: number): BroadcastOperator<Socket> {
    return this.narrow(this.targetRooms, this.exceptRooms, ms);
  }

  compress(_compress: boolean): BroadcastOperator<Socket> {
    return this.narrow(this.targetRooms, this.exceptRooms);
  }

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
   * Collect acknowledgements once (#112), in measured arrival order on 4.7.5 and 4.8.3.
   * Timeout exposes partial responses; late answers may append to that exposed array, and
   * an empty recipient set resolves immediately.
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
