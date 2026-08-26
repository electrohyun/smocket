import { connect as smocketConnect } from 'smocket';
import type {
  ClientSocketContract,
  ConnectOptions as SmocketConnectOptions,
  DefaultEventsMap,
} from 'smocket';

interface EventsMap {
  // Socket.IO uses the same permissive constraint so ordinary event-map interfaces work.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [event: string]: any;
}

/** The supported client-side socket contract. */
export type Socket<
  ListenEvents extends EventsMap = DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
> = ClientSocketContract<ListenEvents, EmitEvents>;

/** Socket-level options implemented by smocket. */
export type SocketOptions = Pick<SmocketConnectOptions, 'auth'>;

type LookupOptions = Pick<SmocketConnectOptions, 'auth' | 'query' | 'forceNew' | 'multiplex'>;

/** Open a client against a server registered by the exact-version smocket peer. */
function lookup(url: string, options?: LookupOptions): Socket {
  return smocketConnect(url, options);
}

const io = lookup;
const connect = lookup;

export { connect, io };
export default lookup;
