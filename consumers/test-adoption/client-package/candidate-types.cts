import smocket = require('smocket');
import sharedWorkerHost = require('smocket/shared-worker');
import client = require('smocket-client');

interface ServerToClientEvents {
  ready: (room: string) => void;
}

interface ClientToServerEvents {
  join: (room: string) => void;
}

// @ts-expect-error Public connect derives its namespace from the URL pathname.
smocket.connect('http://localhost:3277', { namespace: '/ignored' });
// @ts-expect-error Lookup functions stay non-generic under ADR 0021.
client<ServerToClientEvents, ClientToServerEvents>('http://localhost:3277');
// @ts-expect-error The raw bridge protocol is internal to the narrow facade under ADR 0038.
void sharedWorkerHost.SHARED_WORKER_PROTOCOL_VERSION;
