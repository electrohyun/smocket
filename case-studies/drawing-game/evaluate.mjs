import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { STEP_IDS, assertRawTarget, deriveOracleSteps } from './schema.mjs';

function evaluateRawStep(stepId, rawStep, expected) {
  if (rawStep.blockedByStepId) {
    return {
      stepId,
      status: 'BLOCKED',
      expected,
      actual: rawStep.actual ?? null,
      blockedByStepId: rawStep.blockedByStepId,
      reason: rawStep.reason,
      evidenceIds: rawStep.evidenceIds ?? [],
    };
  }

  if (!rawStep.supported) {
    return {
      stepId,
      status: 'UNSUPPORTED',
      expected,
      actual: rawStep.actual ?? null,
      reason: rawStep.reason,
      evidenceIds: rawStep.evidenceIds ?? [],
    };
  }

  return {
    stepId,
    status: isDeepStrictEqual(rawStep.actual, expected) ? 'MATCH' : 'DIFFERENT',
    expected,
    actual: rawStep.actual,
    ...(rawStep.reason ? { reason: rawStep.reason } : {}),
    evidenceIds: rawStep.evidenceIds ?? [],
  };
}

export function createOracle(raw) {
  assertRawTarget(raw);
  assert.equal(raw.targetId, 'real');
  const steps = deriveOracleSteps(raw.observation);
  return {
    targetId: 'real',
    label: 'Real Socket.IO oracle',
    packages: raw.packages,
    fixture: raw.fixture,
    repeatedRunMatches: raw.repeatedRunMatches,
    observation: raw.observation,
    steps,
  };
}

export function evaluateCard(raw, oracle) {
  assertRawTarget(raw);
  const actualSteps = raw.observation ? deriveOracleSteps(raw.observation) : undefined;
  const steps = STEP_IDS.map((stepId) => {
    const rawStep = actualSteps
      ? { supported: true, actual: actualSteps[stepId], evidenceIds: raw.evidenceIds }
      : raw.steps[stepId];
    return evaluateRawStep(stepId, rawStep, oracle.steps[stepId]);
  });

  return {
    targetId: raw.targetId,
    label: raw.label,
    fixture: raw.fixture,
    packages: raw.packages,
    repeatedRunMatches: raw.repeatedRunMatches,
    steps,
    capabilityEvidence: raw.capabilityEvidence ?? [],
  };
}
