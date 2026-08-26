import smocket = require('smocket');

interface EventsMap {
  // Socket.IO uses the same permissive constraint so ordinary event-map interfaces work.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [event: string]: any;
}

type LookupOptions = Pick<smocket.ConnectOptions, 'auth' | 'query' | 'forceNew' | 'multiplex'>;

/** Open a client against a server registered by the exact-version smocket peer. */
function lookup(url: string, options?: LookupOptions): lookup.Socket {
  return smocket.connect(url, options);
}

namespace lookup {
  export const io = lookup;
  export const connect = lookup;

  /** The supported client-side socket contract. */
  export type Socket<
    ListenEvents extends EventsMap = smocket.DefaultEventsMap,
    EmitEvents extends EventsMap = ListenEvents,
  > = smocket.ClientSocketContract<ListenEvents, EmitEvents>;

  /** Socket-level options implemented by smocket. */
  export type SocketOptions = Pick<smocket.ConnectOptions, 'auth'>;
}

export = lookup;
