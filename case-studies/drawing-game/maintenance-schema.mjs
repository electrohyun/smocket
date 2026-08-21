import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const stageSourceRoot = 'case-studies/drawing-game/fixtures/handwritten/stage-sources';

export const HANDWRITTEN_STAGE_DEFINITIONS = [
  {
    id: 'base-single-client',
    label: 'One client/server pair returns one configured response',
    prerequisite: null,
    sources: [{ role: 'transport', sourceFile: `${stageSourceRoot}/01-base-single-client.mjs` }],
  },
  {
    id: 'multiple-clients',
    label: 'Three clients have independent ids and listeners',
    prerequisite: 'base-single-client',
    sources: [{ role: 'transport', sourceFile: `${stageSourceRoot}/02-multiple-clients.mjs` }],
  },
  {
    id: 'room-broadcast',
    label: 'Room membership selects every room member',
    prerequisite: 'multiple-clients',
    sources: [{ role: 'transport', sourceFile: `${stageSourceRoot}/03-room-broadcast.mjs` }],
  },
  {
    id: 'sender-exclusion',
    label: 'Room broadcast excludes its sender',
    prerequisite: 'room-broadcast',
    sources: [{ role: 'transport', sourceFile: `${stageSourceRoot}/04-sender-exclusion.mjs` }],
  },
  {
    id: 'acknowledgement',
    label: 'A server handler can invoke the client callback',
    prerequisite: 'sender-exclusion',
    sources: [{ role: 'transport', sourceFile: `${stageSourceRoot}/05-acknowledgement.mjs` }],
  },
  {
    id: 'targeted-delivery',
    label: 'Socket-id targeting reaches one client',
    prerequisite: 'acknowledgement',
    sources: [{ role: 'transport', sourceFile: `${stageSourceRoot}/06-targeted-delivery.mjs` }],
  },
  {
    id: 'disconnect-cleanup',
    label: 'Disconnect removes socket and room membership',
    prerequisite: 'targeted-delivery',
    sources: [{ role: 'transport', sourceFile: `${stageSourceRoot}/07-disconnect-cleanup.mjs` }],
  },
  {
    id: 'full-workflow',
    label: 'The unchanged golden drawing game runs through the handwritten transport',
    prerequisite: 'disconnect-cleanup',
    sources: [
      { role: 'transport', sourceFile: `${stageSourceRoot}/08-full-workflow.mjs` },
      {
        role: 'client-substitution',
        sourceFile: 'case-studies/drawing-game/fixtures/handwritten/handwritten-loader.mjs',
      },
      {
        role: 'loader-registration',
        sourceFile: 'case-studies/drawing-game/fixtures/handwritten/handwritten-substitution.mjs',
      },
      {
        role: 'application-bootstrap',
        sourceFile: 'case-studies/drawing-game/fixtures/handwritten/bootstrap.mjs',
      },
    ],
  },
];

export const HANDWRITTEN_STAGE_IDS = HANDWRITTEN_STAGE_DEFINITIONS.map(({ id }) => id);

function assertObject(value, message) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), message);
}

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function assertSourceBlock(block, owner) {
  assertObject(block, `${owner} source block is required`);
  assert.equal(typeof block.id, 'string');
  assert.equal(typeof block.role, 'string');
  assert.equal(typeof block.sourceFile, 'string');
  assert.equal(typeof block.language, 'string');
  assert.equal(typeof block.code, 'string');
  assert.match(block.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(sha256(block.code), block.sourceSha256);
  assert.ok(Number.isInteger(block.sourceRange.startLine));
  assert.ok(Number.isInteger(block.sourceRange.endLine));
  assert.ok(block.sourceRange.endLine >= block.sourceRange.startLine);
  assert.equal(block.loc, block.countedLineNumbers.length);
  assert.ok(block.countedLineNumbers.every((line) => Number.isInteger(line)));
}

function assertDiffBlock(block, owner) {
  assertObject(block, `${owner} diff block is required`);
  assert.equal(typeof block.role, 'string');
  assert.equal(typeof block.previousSourceFile, 'string');
  assert.equal(typeof block.currentSourceFile, 'string');
  assert.equal(block.language, 'diff');
  assert.equal(typeof block.code, 'string');
  assert.equal(sha256(block.code), block.sourceSha256);
  assert.ok(Number.isInteger(block.additions));
  assert.ok(Number.isInteger(block.deletions));
  assert.ok(block.additions >= 0 && block.deletions >= 0);
}

export function assertMaintenanceArtifact(artifact) {
  assertObject(artifact, 'maintenance artifact must be an object');
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.caseStudy, 'drawing-game-maintenance-surface');
  assert.match(artifact.sourceRevision, /^[a-f0-9]{40}$/);
  assert.deepEqual(artifact.question.targets, ['smocket', 'handwritten']);
  assert.equal(artifact.question.realSocketIoRole, 'behavior-oracle-only');
  assert.equal(artifact.measurementRules.sharedApplicationCountedAsDifference, false);

  for (const block of artifact.sharedApplication.sourceBlocks) {
    assertSourceBlock(block, 'shared application');
  }
  assert.equal(
    artifact.sharedApplication.loc,
    artifact.sharedApplication.sourceBlocks.reduce((sum, block) => sum + block.loc, 0),
  );
  for (const block of artifact.smocketIntegration.sourceBlocks) {
    assertSourceBlock(block, 'Smocket integration');
  }
  assert.equal(
    artifact.smocketIntegration.totalLoc,
    artifact.smocketIntegration.sourceBlocks.reduce((sum, block) => sum + block.loc, 0),
  );

  assert.deepEqual(
    artifact.stages.map(({ id }) => id),
    HANDWRITTEN_STAGE_IDS,
  );
  let previousTotal = 0;
  for (const [index, stage] of artifact.stages.entries()) {
    const definition = HANDWRITTEN_STAGE_DEFINITIONS[index];
    assert.equal(stage.id, definition.id);
    assert.equal(stage.label, definition.label);
    assert.equal(stage.prerequisite, definition.prerequisite);
    assert.deepEqual(
      stage.sourceFiles,
      definition.sources.map(({ sourceFile }) => sourceFile),
    );
    assert.equal(new Set(stage.sourceFiles).size, stage.sourceFiles.length);
    assert.match(stage.sourceHash, /^[a-f0-9]{64}$/);
    for (const block of stage.sourceBlocks) assertSourceBlock(block, stage.id);
    for (const block of stage.diffBlocks) assertDiffBlock(block, stage.id);
    assert.equal(
      stage.totalLoc,
      stage.sourceBlocks.reduce((sum, block) => sum + block.loc, 0),
    );
    assert.equal(
      stage.change.additions,
      stage.diffBlocks.reduce((sum, block) => sum + block.additions, 0),
    );
    assert.equal(
      stage.change.deletions,
      stage.diffBlocks.reduce((sum, block) => sum + block.deletions, 0),
    );
    assert.equal(stage.change.net, stage.change.additions - stage.change.deletions);
    assert.equal(stage.totalLoc, previousTotal + stage.change.net);
    assert.equal(stage.validation.passed, true);
    assert.ok(stage.validation.assertions.length > 0);
    previousTotal = stage.totalLoc;
  }

  assert.equal(artifact.finalWorkflow.realVsSmocketDeepEqual, true);
  assert.equal(artifact.finalWorkflow.realVsHandwrittenDeepEqual, true);
  assert.equal(artifact.finalWorkflow.repeatedRunMatches.real, true);
  assert.equal(artifact.finalWorkflow.repeatedRunMatches.smocket, true);
  assert.equal(artifact.finalWorkflow.repeatedRunMatches.handwritten, true);
  assert.ok(artifact.interpretation.length >= 4);
  assert.ok(artifact.limitations.length >= 3);
  return artifact;
}

export function assertMaintenanceSnippets(artifact) {
  assertObject(artifact, 'maintenance snippets must be an object');
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.caseStudy, 'drawing-game-maintenance-surface');
  assert.match(artifact.sourceRevision, /^[a-f0-9]{40}$/);
  assert.deepEqual(artifact.stageIds, HANDWRITTEN_STAGE_IDS);
  const ids = new Set();
  for (const snippet of artifact.snippets) {
    assert.equal(ids.has(snippet.id), false, `duplicate snippet ${snippet.id}`);
    ids.add(snippet.id);
    assert.ok(['handwritten', 'smocket'].includes(snippet.owner));
    assert.ok(['source', 'diff'].includes(snippet.kind));
    assert.equal(typeof snippet.code, 'string');
    assert.equal(sha256(snippet.code), snippet.sourceSha256);
    if (snippet.owner === 'handwritten') {
      assert.ok(HANDWRITTEN_STAGE_IDS.includes(snippet.stageId));
    }
  }
  for (const stageId of HANDWRITTEN_STAGE_IDS) {
    assert.ok(
      artifact.snippets.some((snippet) => snippet.stageId === stageId && snippet.kind === 'source'),
      `missing source snippet for ${stageId}`,
    );
    assert.ok(
      artifact.snippets.some((snippet) => snippet.stageId === stageId && snippet.kind === 'diff'),
      `missing diff snippet for ${stageId}`,
    );
  }
  assert.ok(artifact.snippets.some(({ owner }) => owner === 'smocket'));
  return artifact;
}
