import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findClosedTrackedIssues, trackedIssueReferences } from './check-public-surface-issues.mjs';

const entries = [
  {
    disposition: 'tracked-issue',
    reference: 'https://github.com/electrohyun/smocket/issues/10',
  },
  {
    disposition: 'tracked-issue',
    reference: 'https://github.com/electrohyun/smocket/issues/10',
  },
  {
    disposition: 'implemented',
    reference: 'https://github.com/electrohyun/smocket/issues/11',
  },
];

test('deduplicates tracked issue references and ignores other dispositions', () => {
  assert.deepEqual(trackedIssueReferences(entries), [
    {
      number: 10,
      owner: 'electrohyun',
      reference: 'https://github.com/electrohyun/smocket/issues/10',
      repository: 'smocket',
    },
  ]);
});

test('reports a tracked issue after it closes', async () => {
  assert.deepEqual(await findClosedTrackedIssues(entries, async () => 'closed'), [
    {
      number: 10,
      owner: 'electrohyun',
      reference: 'https://github.com/electrohyun/smocket/issues/10',
      repository: 'smocket',
      state: 'closed',
    },
  ]);
  assert.deepEqual(await findClosedTrackedIssues(entries, async () => 'open'), []);
});

test('rejects malformed tracked issue references', () => {
  assert.throws(
    () => trackedIssueReferences([{ disposition: 'tracked-issue', reference: 'issue-10' }]),
    /Invalid tracked issue reference/,
  );
});
