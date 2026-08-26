import { connect } from 'smocket';
import * as sharedWorkerHost from 'smocket/shared-worker';
import { io } from 'smocket-client';

interface ServerToClientEvents {
  ready: (room: string) => void;
}

interface ClientToServerEvents {
  join: (room: string) => void;
}

// @ts-expect-error Public connect derives its namespace from the URL pathname.
connect('http://localhost:3276', { namespace: '/ignored' });
// @ts-expect-error Lookup functions stay non-generic under ADR 0021.
io<ServerToClientEvents, ClientToServerEvents>('http://localhost:3276');
// @ts-expect-error The raw bridge protocol is internal to the narrow facade under ADR 0038.
void sharedWorkerHost.SHARED_WORKER_PROTOCOL_VERSION;
