import assert from 'node:assert/strict';
import { connectSharedWorker as clientConnectSharedWorker } from 'smocket-client/shared-worker';
import { connectSharedWorker as rootConnectSharedWorker } from 'smocket/shared-worker';

assert.equal(clientConnectSharedWorker, rootConnectSharedWorker);
