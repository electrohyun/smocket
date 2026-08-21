import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { observeSmocketTarget } from '../../../../examples/drawing-game/dist/smocket/smocket.js';

const serverManifest = JSON.parse(
  await readFile(new URL('../../../../package.json', import.meta.url), 'utf8'),
);
const clientManifest = JSON.parse(
  await readFile(
    new URL('../../../../packages/smocket-client/package.json', import.meta.url),
    'utf8',
  ),
);
assert.equal(serverManifest.version, clientManifest.version);

const first = await observeSmocketTarget();
const second = await observeSmocketTarget();
assert.deepEqual(second, first);

process.stdout.write(
  JSON.stringify({
    schemaVersion: 1,
    targetId: 'smocket',
    label: 'Smocket workspace source',
    fixture: 'case-studies/drawing-game/fixtures/smocket',
    packages: {
      smocket: `workspace:${serverManifest.version}`,
      'smocket-client': `workspace:${clientManifest.version}`,
    },
    repeatedRunMatches: true,
    observation: first,
    evidenceIds: ['smocket-workspace-substitution'],
    capabilityEvidence: [
      {
        id: 'smocket-workspace-substitution',
        kind: 'source',
        source: 'examples/drawing-game/smocket-loader.mjs',
        finding: 'socket.io-client resolves to the workspace smocket-client build for this target.',
      },
    ],
  }),
);
