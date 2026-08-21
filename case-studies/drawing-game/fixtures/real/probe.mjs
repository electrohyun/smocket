import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { observeRealTarget } from '../../../../examples/drawing-game/dist/real/real.js';

const require = createRequire(import.meta.url);
const packages = {
  'socket.io': require('socket.io/package.json').version,
  'socket.io-client': require('socket.io-client/package.json').version,
};
assert.deepEqual(packages, { 'socket.io': '4.8.3', 'socket.io-client': '4.8.3' });

const first = await observeRealTarget();
const second = await observeRealTarget();
assert.deepEqual(second, first);

process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    targetId: 'real',
    label: 'Real Socket.IO oracle',
    fixture: 'case-studies/drawing-game/fixtures/real',
    packages,
    repeatedRunMatches: true,
    observation: first,
  }),
);
