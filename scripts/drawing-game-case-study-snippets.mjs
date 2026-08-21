import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  STEP_IDS,
  TARGET_IDS,
  assertMeasurementArtifact,
} from '../case-studies/drawing-game/schema.mjs';

const root = resolve(import.meta.dirname, '..');
const caseStudyRoot = resolve(root, 'case-studies/drawing-game');
const artifactPath = resolve(caseStudyRoot, 'snippets.generated.json');
const observationPath = resolve(caseStudyRoot, 'observations.generated.json');
const goldenSnippetPath = resolve(root, 'examples/drawing-game/snippets.generated.json');
const regenerateWith = 'pnpm case-study:drawing-game:snippets';
const marker = /^\s*\/\/ \[case-snippet:(start|end) ([a-z0-9-]+)\]\s*$/;

const purposes = {
  '1-connect': 'Create A, B, and C as independent clients.',
  '2-room-join': 'Join room-1 and return the acknowledgement.',
  '3-sender-excluded-stroke': 'Send A stroke to B and C while excluding A.',
  '4-wrong-guess': 'Return false and deliver B wrong guess as room chat.',
  '5-correct-guess': 'Return true, target C, and announce to the room.',
  '6-disconnect': 'Disconnect C and route the next A stroke only to B.',
};

const goldenMapping = {
  real: {
    '1-connect': 'real-bootstrap',
    '2-room-join': 'room-join',
    '3-sender-excluded-stroke': 'drawing-server-handler',
    '4-wrong-guess': 'chat-guess-server-handler',
    '5-correct-guess': 'chat-guess-server-handler',
    '6-disconnect': 'disconnect-behavior',
  },
  smocket: {
    '1-connect': 'smocket-bootstrap',
    '2-room-join': 'room-join',
    '3-sender-excluded-stroke': 'drawing-server-handler',
    '4-wrong-guess': 'chat-guess-server-handler',
    '5-correct-guess': 'chat-guess-server-handler',
    '6-disconnect': 'disconnect-behavior',
  },
};

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function trimBlankLines(lines) {
  while (lines[0]?.trim() === '') lines.shift();
  while (lines.at(-1)?.trim() === '') lines.pop();
  return lines;
}

async function extractFixture(targetId) {
  const sourceFile = `case-studies/drawing-game/fixtures/${targetId}/probe.mjs`;
  const source = await readFile(resolve(root, sourceFile), 'utf8');
  const snippets = new Map(STEP_IDS.map((stepId) => [stepId, []]));
  const open = [];
  const seen = new Set();

  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const match = marker.exec(line);
    if (match) {
      const [, operation, stepId] = match;
      assert.ok(snippets.has(stepId), `unknown ${targetId} snippet ${stepId}`);
      if (operation === 'start') {
        assert.equal(seen.has(stepId), false, `duplicate ${targetId}/${stepId}`);
        seen.add(stepId);
        open.push(stepId);
      } else {
        assert.equal(open.pop(), stepId, `unbalanced ${targetId}/${stepId}`);
      }
      continue;
    }
    for (const stepId of open) snippets.get(stepId).push(line);
  }

  assert.deepEqual([...seen], STEP_IDS);
  assert.equal(open.length, 0);
  return { sourceFile, snippets };
}

const observation = JSON.parse(await readFile(observationPath, 'utf8'));
assertMeasurementArtifact(observation);
const golden = JSON.parse(await readFile(goldenSnippetPath, 'utf8'));
const goldenById = new Map(golden.snippets.map((snippet) => [snippet.id, snippet]));
const statusByTargetStep = new Map();
for (const card of observation.cards) {
  for (const step of card.steps) statusByTargetStep.set(`${card.targetId}:${step.stepId}`, step);
}

const snippets = [];
for (const targetId of ['real', 'smocket']) {
  for (const stepId of STEP_IDS) {
    const sourceSnippet = goldenById.get(goldenMapping[targetId][stepId]);
    assert.ok(sourceSnippet);
    const measured = statusByTargetStep.get(`${targetId}:${stepId}`);
    snippets.push({
      id: `${targetId}.${stepId}`,
      targetId,
      stepId,
      sourceFile: sourceSnippet.sourceFile,
      language: sourceSnippet.language,
      purpose: purposes[stepId],
      code: sourceSnippet.code,
      sourceSha256: sha256(sourceSnippet.code),
      status: targetId === 'real' ? 'ORACLE' : measured.status,
    });
  }
}

for (const targetId of TARGET_IDS.filter((id) => id !== 'real' && id !== 'smocket')) {
  const { sourceFile, snippets: extracted } = await extractFixture(targetId);
  for (const stepId of STEP_IDS) {
    const code = trimBlankLines(extracted.get(stepId)).join('\n');
    const measured = statusByTargetStep.get(`${targetId}:${stepId}`);
    snippets.push({
      id: `${targetId}.${stepId}`,
      targetId,
      stepId,
      sourceFile,
      language: 'javascript',
      purpose: purposes[stepId],
      code,
      sourceSha256: sha256(code),
      status: measured.status,
      ...(measured.blockedByStepId ? { blockedByStepId: measured.blockedByStepId } : {}),
    });
  }
}

const substitution = goldenById.get('smocket-client-substitution');
snippets.push({
  id: 'smocket.1-connect.substitution',
  targetId: 'smocket',
  stepId: '1-connect',
  sourceFile: substitution.sourceFile,
  language: substitution.language,
  purpose: 'Substitute socket.io-client with smocket-client for the Smocket target.',
  code: substitution.code,
  sourceSha256: sha256(substitution.code),
  status: statusByTargetStep.get('smocket:1-connect').status,
});

const artifact = {
  schemaVersion: 1,
  sourceRevision: observation.environment.smocketSourceCommit,
  regenerateWith,
  snippets,
};
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;

if (process.argv.includes('--write')) {
  await writeFile(artifactPath, serialized);
  console.log(`Wrote ${artifactPath}`);
} else if (process.argv.includes('--check')) {
  const current = await readFile(artifactPath, 'utf8');
  assert.equal(
    current,
    serialized,
    `Snippet artifact is stale. Regenerate with: ${regenerateWith}`,
  );
  console.log('Drawing-game case-study snippets are current.');
} else {
  process.stdout.write(serialized);
}
