import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEP_IDS, TARGET_IDS, assertMeasurementArtifact } from './schema.mjs';
import {
  MAINTENANCE_FEATURE_IDS,
  assertMaintenanceArtifact,
  assertMaintenanceSnippets,
  prerequisiteClosure,
} from './maintenance-schema.mjs';
import {
  createMaintenanceSnippetArtifact,
  createMaintenanceSourceModel,
} from './maintenance-source.mjs';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDirectory, '../..');

async function readMeasurement() {
  return JSON.parse(
    await readFile(resolve(moduleDirectory, 'observations.generated.json'), 'utf8'),
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
    await readFile(resolve(moduleDirectory, 'snippets.generated.json'), 'utf8'),
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
    await readFile(resolve(moduleDirectory, 'snippets.generated.json'), 'utf8'),
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

test('the staged maintenance artifact satisfies its schema and oracle comparisons', async () => {
  const artifact = JSON.parse(
    await readFile(resolve(moduleDirectory, 'maintenance.generated.json'), 'utf8'),
  );
  assertMaintenanceArtifact(artifact);
  assert.deepEqual(
    artifact.finalWorkflow.observations.smocket,
    artifact.finalWorkflow.observations.real,
  );
  assert.deepEqual(
    artifact.finalWorkflow.observations.handwritten,
    artifact.finalWorkflow.observations.real,
  );
});

test('every handwritten feature stage ran with its prerequisite closure', async () => {
  const artifact = JSON.parse(
    await readFile(resolve(moduleDirectory, 'maintenance.generated.json'), 'utf8'),
  );
  assert.ok(artifact.stages.every(({ passed }) => passed));
  assert.deepEqual(
    artifact.stages.map(({ enabledFeatureIds }) => enabledFeatureIds),
    MAINTENANCE_FEATURE_IDS.map(prerequisiteClosure),
  );
});

test('the maintenance line counter and snippet extraction are deterministic', async () => {
  assert.deepEqual(await createMaintenanceSourceModel(), await createMaintenanceSourceModel());
  const measurement = JSON.parse(
    await readFile(resolve(moduleDirectory, 'maintenance.generated.json'), 'utf8'),
  );
  const snippets = JSON.parse(
    await readFile(resolve(moduleDirectory, 'maintenance-snippets.generated.json'), 'utf8'),
  );
  assertMaintenanceSnippets(snippets);
  assert.deepEqual(snippets, await createMaintenanceSnippetArtifact(measurement.sourceRevision));
});

test('the handwritten transport contains no drawing-game answers or named fixtures', async () => {
  const model = await createMaintenanceSourceModel();
  const sourceFiles = new Set(
    [...model.handwrittenByFeature.values()].flat().map(({ sourceFile }) => sourceFile),
  );
  for (const sourceFile of sourceFiles) {
    const source = await readFile(resolve(root, sourceFile), 'utf8');
    for (const forbidden of ["'A'", "'B'", "'C'", 'room-1', 'giraffe', 'zebra']) {
      assert.equal(source.includes(forbidden), false, `${sourceFile} contains ${forbidden}`);
    }
  }
});
