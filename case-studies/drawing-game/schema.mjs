import assert from 'node:assert/strict';

export const STEP_IDS = [
  '1-connect',
  '2-room-join',
  '3-sender-excluded-stroke',
  '4-wrong-guess',
  '5-correct-guess',
  '6-disconnect',
];

export const TARGET_IDS = ['real', 'smocket', 'mock-socket', 'msw-binding', 'socket.io-mock'];
export const CARD_TARGET_IDS = TARGET_IDS.filter((targetId) => targetId !== 'real');
export const STATUSES = ['MATCH', 'DIFFERENT', 'UNSUPPORTED', 'BLOCKED'];

export function deriveOracleSteps(observation) {
  const [firstStroke, wrongChat, targetedCorrect, roomAnnounce, secondStroke] =
    observation.deliveries;
  const [wrongAcknowledgement, correctAcknowledgement] = observation.acknowledgements;

  return {
    '1-connect': {
      connections: observation.connections,
      distinctSocketIds: observation.distinctSocketIds,
    },
    '2-room-join': { joins: observation.joins },
    '3-sender-excluded-stroke': { delivery: firstStroke },
    '4-wrong-guess': {
      acknowledgement: wrongAcknowledgement,
      delivery: wrongChat,
    },
    '5-correct-guess': {
      acknowledgement: correctAcknowledgement,
      targeted: targetedCorrect,
      announce: roomAnnounce,
    },
    '6-disconnect': {
      disconnect: observation.disconnect,
      delivery: secondStroke,
    },
  };
}

function assertObject(value, message) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), message);
}

export function assertRawTarget(raw) {
  assertObject(raw, 'target probe must return an object');
  assert.equal(typeof raw.targetId, 'string');
  assert.ok(TARGET_IDS.includes(raw.targetId), `unknown target id ${raw.targetId}`);
  assert.equal(raw.schemaVersion, 1);
  assert.equal(raw.repeatedRunMatches, true);
  if (raw.observation) return raw;

  assertObject(raw.steps, `${raw.targetId} must provide step observations`);
  for (const stepId of STEP_IDS) {
    const step = raw.steps[stepId];
    assertObject(step, `${raw.targetId} is missing ${stepId}`);
    assert.equal(typeof step.supported, 'boolean');
    if (step.blockedByStepId !== undefined) {
      assert.ok(STEP_IDS.includes(step.blockedByStepId));
      assert.ok(STEP_IDS.indexOf(step.blockedByStepId) < STEP_IDS.indexOf(stepId));
    }
  }
  return raw;
}

export function assertMeasurementArtifact(artifact) {
  assertObject(artifact, 'measurement artifact must be an object');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.caseStudy, 'drawing-game-compatibility');
  assert.deepEqual(artifact.workflow.stepIds, STEP_IDS);
  assertObject(artifact.environment, 'environment is required');
  assert.equal(typeof artifact.environment.measuredAt, 'string');
  assert.equal(typeof artifact.environment.platform, 'string');
  assert.equal(typeof artifact.environment.architecture, 'string');
  assert.equal(typeof artifact.environment.node, 'string');
  assert.equal(typeof artifact.environment.smocketSourceCommit, 'string');
  assert.equal(typeof artifact.environment.sourceState, 'string');
  assertObject(artifact.oracle, 'oracle is required');
  assert.equal(artifact.oracle.targetId, 'real');
  assertObject(artifact.oracle.observation, 'oracle observation is required');
  assert.deepEqual(Object.keys(artifact.oracle.steps), STEP_IDS);
  assert.deepEqual(
    artifact.cards.map(({ targetId }) => targetId),
    CARD_TARGET_IDS,
  );

  for (const card of artifact.cards) {
    assertObject(card.packages, `${card.targetId} packages are required`);
    assert.equal(card.steps.length, STEP_IDS.length);
    assert.equal(card.repeatedRunMatches, true);
    for (const [index, step] of card.steps.entries()) {
      assert.equal(step.stepId, STEP_IDS[index]);
      assert.ok(STATUSES.includes(step.status));
      assertObject(step.expected, `${card.targetId}/${step.stepId} expected value is required`);
      if (step.status === 'BLOCKED') {
        assert.ok(STEP_IDS.includes(step.blockedByStepId));
      } else {
        assert.equal(step.blockedByStepId, undefined);
      }
      if (step.status === 'UNSUPPORTED') assert.equal(typeof step.reason, 'string');
    }
  }

  return artifact;
}
