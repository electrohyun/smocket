import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { STEP_IDS, TARGET_IDS, assertMeasurementArtifact } from './schema.mjs';

const root = resolve(import.meta.dirname, '../..');

async function readMeasurement() {
  return JSON.parse(
    await readFile(resolve(import.meta.dirname, 'observations.generated.json'), 'utf8'),
  );
}

test('the generated measurement satisfies the shared schema', async () => {
  const artifact = await readMeasurement();
  assertMeasurementArtifact(artifact);
});

test('the shared schema rejects incomplete oracle observations', async () => {
  const artifact = await readMeasurement();
  artifact.oracle.observation.deliveries.pop();
  assert.throws(() => assertMeasurementArtifact(artifact));
});

test('the shared schema rejects blockers that do not establish causality', async () => {
  const artifact = await readMeasurement();
  const card = artifact.cards.find(({ targetId }) => targetId === 'smocket');
  card.steps[1].status = 'BLOCKED';
  card.steps[1].blockedByStepId = '1-connect';
  assert.throws(() => assertMeasurementArtifact(artifact));

  card.steps[1].blockedByStepId = '2-room-join';
  assert.throws(() => assertMeasurementArtifact(artifact));
});

test('generated snippets cover every target and workflow step', async () => {
  const artifact = JSON.parse(
    await readFile(resolve(import.meta.dirname, 'snippets.generated.json'), 'utf8'),
  );
  for (const targetId of TARGET_IDS) {
    for (const stepId of STEP_IDS) {
      assert.ok(
        artifact.snippets.some(
          (snippet) => snippet.targetId === targetId && snippet.stepId === stepId,
        ),
        `missing snippet for ${targetId}/${stepId}`,
      );
    }
  }
});

test('public golden source and generated snippets expose no bootstrap cast', async () => {
  const publicSource = await Promise.all(
    ['application.ts', 'client.ts'].map((file) =>
      readFile(resolve(root, 'examples/drawing-game', file), 'utf8'),
    ),
  );
  const snippets = JSON.parse(
    await readFile(resolve(import.meta.dirname, 'snippets.generated.json'), 'utf8'),
  );
  assert.equal(
    publicSource.some((source) => source.includes('as unknown as')),
    false,
  );
  assert.equal(
    snippets.snippets.some(({ code }) => code.includes('as unknown as')),
    false,
  );
});
