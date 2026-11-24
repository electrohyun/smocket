const assert = require('node:assert/strict');
const { greeting } = require('./scenario.cjs');

function assertObservation(actual, includeSender) {
  const fromA = [
    { data: greeting, binary: false },
    { data: [1, 2, 3], binary: true },
    { data: [4, 5], binary: true },
    { data: 'tail', binary: false },
    { data: 'marker:A', binary: false },
  ];
  const fromB = { data: 'marker:B', binary: false };
  const afterLeave = { data: 'after:B-left', binary: false };

  assert.deepEqual(actual.messages, [
    includeSender ? [...fromA, fromB, afterLeave] : [fromB],
    includeSender ? [...fromA, fromB] : fromA,
    [...fromA, fromB, afterLeave],
  ]);
  assert.deepEqual(actual.membership, [3, 2, 0]);
  assert.deepEqual(actual.closes, [
    { code: 1000, reason: 'done' },
    { code: 1000, reason: 'left' },
    { code: 1000, reason: 'done' },
  ]);
  assert.deepEqual(actual.states, [3, 3, 3]);
  assert.equal(actual.address, null);
  assert.deepEqual(actual.errors, []);
}

module.exports = { assertObservation };
