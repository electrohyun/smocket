const assert = require('node:assert/strict');
const { connectSharedWorker: clientConnectSharedWorker } = require('smocket-client/shared-worker');
const { connectSharedWorker: rootConnectSharedWorker } = require('smocket/shared-worker');

assert.equal(clientConnectSharedWorker, rootConnectSharedWorker);
