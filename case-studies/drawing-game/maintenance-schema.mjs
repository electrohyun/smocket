import assert from 'node:assert/strict';

export const MAINTENANCE_FEATURES = [
  {
    id: 'base-single-client',
    label: 'One drawing client sends and receives',
    socketIoMeaning:
      'One client/server socket pair registers listeners and returns one configured response.',
    requires: [],
    goldenSnippetIds: ['drawing-client'],
  },
  {
    id: 'multiple-clients',
    label: 'A, B, and C connect independently',
    socketIoMeaning: 'Each connection owns a distinct socket id and listener registry.',
    requires: ['base-single-client'],
    goldenSnippetIds: ['drawing-client'],
  },
  {
    id: 'room-broadcast',
    label: 'Players join one game room',
    socketIoMeaning: 'Server-owned room membership selects every connected room member.',
    requires: ['multiple-clients'],
    goldenSnippetIds: ['room-join', 'room-announce'],
  },
  {
    id: 'sender-exclusion',
    label: "A's stroke reaches only peers",
    socketIoMeaning: 'socket.to(room) excludes the originating socket from room delivery.',
    requires: ['room-broadcast'],
    goldenSnippetIds: ['drawing-server-handler'],
  },
  {
    id: 'acknowledgement',
    label: 'Guesses receive a boolean result',
    socketIoMeaning:
      'A client callback crosses the event boundary and is invoked by the server handler.',
    requires: ['base-single-client'],
    goldenSnippetIds: ['acknowledgement', 'chat-guess-client'],
  },
  {
    id: 'targeted-delivery',
    label: 'Only the winner receives correct',
    socketIoMeaning: 'io.to(socket.id) selects one connected socket rather than a room.',
    requires: ['multiple-clients'],
    goldenSnippetIds: ['targeted-correct'],
  },
  {
    id: 'disconnect-cleanup',
    label: 'C leaves before the next stroke',
    socketIoMeaning:
      'Disconnect removes socket and room state before later routing selects recipients.',
    requires: ['sender-exclusion'],
    goldenSnippetIds: ['disconnect-behavior'],
  },
];

export const MAINTENANCE_FEATURE_IDS = MAINTENANCE_FEATURES.map(({ id }) => id);

export function prerequisiteClosure(featureId) {
  const selected = new Set();
  function visit(id) {
    const feature = MAINTENANCE_FEATURES.find((candidate) => candidate.id === id);
    assert.ok(feature, `unknown maintenance feature ${id}`);
    for (const requiredId of feature.requires) visit(requiredId);
    selected.add(id);
  }
  visit(featureId);
  selected.delete('base-single-client');
  return MAINTENANCE_FEATURE_IDS.filter((id) => selected.has(id));
}

function assertObject(value, message) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), message);
}

function assertSourceBlock(block, owner) {
  assertObject(block, `${owner} source block is required`);
  assert.equal(typeof block.id, 'string');
  assert.equal(typeof block.sourceFile, 'string');
  assert.equal(typeof block.language, 'string');
  assert.equal(typeof block.code, 'string');
  assert.match(block.sourceSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isInteger(block.sourceRange.startLine));
  assert.ok(block.sourceRange.endLine >= block.sourceRange.startLine);
  assert.equal(block.loc, block.countedLineNumbers.length);
  assert.ok(block.countedLineNumbers.every((line) => Number.isInteger(line)));
}

export function assertMaintenanceArtifact(artifact) {
  assertObject(artifact, 'maintenance artifact must be an object');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.caseStudy, 'drawing-game-maintenance-surface');
  assert.equal(typeof artifact.sourceRevision, 'string');
  assert.equal(artifact.question.targets.join(','), 'smocket,handwritten');
  assert.equal(artifact.question.realSocketIoRole, 'behavior-oracle-only');
  assertObject(artifact.measurementRules, 'measurement rules are required');
  assert.equal(artifact.measurementRules.sharedApplicationCountedAsDifference, false);
  assert.ok(artifact.countedFiles.length > 0);
  assert.ok(artifact.excludedFiles.length > 0);
  for (const file of artifact.countedFiles) {
    assert.equal(file.loc, file.countedLineNumbers.length);
    assert.equal(new Set(file.countedLineNumbers).size, file.countedLineNumbers.length);
  }
  const countedPaths = new Set(artifact.countedFiles.map(({ sourceFile }) => sourceFile));
  for (const excluded of artifact.excludedFiles) {
    assert.equal(countedPaths.has(excluded.sourceFile), false);
    assert.equal(typeof excluded.reason, 'string');
  }
  assert.ok(artifact.sourceInputs.length > 0);
  for (const input of artifact.sourceInputs) {
    assert.equal(typeof input.sourceFile, 'string');
    assert.match(input.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(
    artifact.sharedApplication.loc,
    artifact.sharedApplication.countedLineNumbers.length,
  );
  assert.deepEqual(
    artifact.features.map(({ id }) => id),
    MAINTENANCE_FEATURE_IDS,
  );
  assert.deepEqual(
    artifact.stages.map(({ id }) => id),
    MAINTENANCE_FEATURE_IDS,
  );

  let smocketCumulative = 0;
  let handwrittenCumulative = 0;
  for (const [index, feature] of artifact.features.entries()) {
    const definition = MAINTENANCE_FEATURES[index];
    assert.equal(feature.id, definition.id);
    assert.equal(feature.label, definition.label);
    assert.equal(feature.socketIoMeaning, definition.socketIoMeaning);
    assert.deepEqual(feature.requires, definition.requires);
    assert.deepEqual(feature.goldenSnippetIds, definition.goldenSnippetIds);
    assert.equal(feature.validation.passed, true);
    assert.deepEqual(feature.validation.enabledFeatureIds, prerequisiteClosure(feature.id));

    for (const targetId of ['smocket', 'handwritten']) {
      const target = feature.targets[targetId];
      assertObject(target, `${feature.id}/${targetId} is required`);
      assert.equal(target.deltaLabel, `+${target.deltaLoc} lines`);
      for (const block of target.sourceBlocks) assertSourceBlock(block, targetId);
      assert.equal(
        target.deltaLoc,
        target.sourceBlocks.reduce((sum, block) => sum + block.loc, 0),
      );
    }

    smocketCumulative += feature.targets.smocket.deltaLoc;
    handwrittenCumulative += feature.targets.handwritten.deltaLoc;
    assert.equal(feature.targets.smocket.cumulativeLoc, smocketCumulative);
    assert.equal(feature.targets.handwritten.cumulativeLoc, handwrittenCumulative);
    if (index > 0) assert.equal(feature.targets.smocket.deltaLoc, 0);
  }

  assert.equal(artifact.finalWorkflow.realVsSmocketDeepEqual, true);
  assert.equal(artifact.finalWorkflow.realVsHandwrittenDeepEqual, true);
  assert.equal(artifact.finalWorkflow.repeatedRunMatches.real, true);
  assert.equal(artifact.finalWorkflow.repeatedRunMatches.smocket, true);
  assert.equal(artifact.finalWorkflow.repeatedRunMatches.handwritten, true);
  assert.ok(artifact.interpretation.length >= 4);
  assert.ok(artifact.limitations.length >= 2);
  return artifact;
}

export function assertMaintenanceSnippets(artifact) {
  assertObject(artifact, 'maintenance snippets must be an object');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.caseStudy, 'drawing-game-maintenance-surface');
  assert.deepEqual(artifact.featureIds, MAINTENANCE_FEATURE_IDS);
  const ids = new Set();
  for (const snippet of artifact.snippets) {
    assert.ok(MAINTENANCE_FEATURE_IDS.includes(snippet.featureId));
    assert.equal(ids.has(snippet.id), false, `duplicate snippet ${snippet.id}`);
    ids.add(snippet.id);
    assertSourceBlock(snippet, snippet.ownership);
  }
  for (const featureId of MAINTENANCE_FEATURE_IDS) {
    assert.ok(
      artifact.snippets.some((snippet) => snippet.featureId === featureId),
      `missing snippets for ${featureId}`,
    );
  }
  return artifact;
}
