import smocket = require('smocket');
import smocketSharedWorker = require('smocket/shared-worker');

interface EventsMap {
  // Match the permissive generic constraint used by the ESM and root entries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [event: string]: any;
}

export const connectSharedWorker = smocketSharedWorker.connectSharedWorker;
export type SharedWorkerConnectOptions = smocketSharedWorker.SharedWorkerConnectOptions;
export type SharedWorkerSocket<
  ListenEvents extends EventsMap = smocket.DefaultEventsMap,
  EmitEvents extends EventsMap = ListenEvents,
> = smocketSharedWorker.SharedWorkerSocket<ListenEvents, EmitEvents>;
export type SharedWorkerSocketReservedEvents = smocketSharedWorker.SharedWorkerSocketReservedEvents;
