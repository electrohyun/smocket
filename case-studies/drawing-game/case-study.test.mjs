import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEP_IDS, TARGET_IDS, assertMeasurementArtifact } from './schema.mjs';
import {
  HANDWRITTEN_STAGE_DEFINITIONS,
  HANDWRITTEN_STAGE_IDS,
  assertMaintenanceArtifact,
  assertMaintenanceSnippets,
} from './maintenance-schema.mjs';
import {
  createMaintenanceSnippetArtifact,
  createMaintenanceSourceModel,
} from './maintenance-source.mjs';
import {
  assertPublicationArtifact,
  createPublicationArtifact,
  loadPublicationInputs,
} from './publication-schema.mjs';

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

test('every handwritten stage ran from its declared source closure', async () => {
  const artifact = JSON.parse(
    await readFile(resolve(moduleDirectory, 'maintenance.generated.json'), 'utf8'),
  );
  assert.ok(artifact.stages.every(({ validation }) => validation.passed));
  assert.deepEqual(
    artifact.stages.map(({ id, prerequisite, sourceFiles }) => ({
      id,
      prerequisite,
      sourceFiles,
    })),
    HANDWRITTEN_STAGE_DEFINITIONS.map(({ id, prerequisite, sources }) => ({
      id,
      prerequisite,
      sourceFiles: sources.map(({ sourceFile }) => sourceFile),
    })),
  );

  const stageRunner = await readFile(
    resolve(moduleDirectory, 'fixtures/handwritten/stages.mjs'),
    'utf8',
  );
  for (const definition of HANDWRITTEN_STAGE_DEFINITIONS.slice(0, -1)) {
    assert.ok(stageRunner.includes(basename(definition.sources[0].sourceFile)));
  }
  const finalSource = basename(HANDWRITTEN_STAGE_DEFINITIONS.at(-1).sources[0].sourceFile);
  const finalLoaders = await Promise.all(
    ['bootstrap.mjs', 'handwritten-loader.mjs'].map((sourceFile) =>
      readFile(resolve(moduleDirectory, 'fixtures/handwritten', sourceFile), 'utf8'),
    ),
  );
  assert.ok(finalLoaders.every((source) => source.includes(finalSource)));
});

test('the final handwritten client exposes its deferred connect lifecycle', async () => {
  const { Server, io } = await import('./fixtures/handwritten/stage-sources/08-full-workflow.mjs');
  const origin = 'http://drawing-game-connect-timing.handwritten.test';
  const server = new Server(origin);
  const order = [];
  server.on('connection', () => order.push('server connection'));
  const client = io(origin);
  assert.equal(client.connected, false);
  let connectionDeadline;
  const connected = new Promise((resolve, reject) => {
    connectionDeadline = setTimeout(
      () => reject(new Error('handwritten client did not connect')),
      1_000,
    );
    client.once('connect', () => {
      clearTimeout(connectionDeadline);
      order.push('client connect');
      resolve();
    });
  });

  try {
    await connected;
    assert.equal(client.connected, true);
    assert.deepEqual(order, ['server connection', 'client connect']);
  } finally {
    clearTimeout(connectionDeadline);
    client.disconnect();
    await server.close();
  }
});

test('the maintenance closures, LOC diffs, and snippets are deterministic', async () => {
  const firstModel = await createMaintenanceSourceModel();
  const secondModel = await createMaintenanceSourceModel();
  assert.deepEqual(firstModel, secondModel);
  let previousTotal = 0;
  for (const stage of firstModel.stages) {
    assert.equal(previousTotal + stage.change.additions - stage.change.deletions, stage.totalLoc);
    previousTotal = stage.totalLoc;
  }
  const measurement = JSON.parse(
    await readFile(resolve(moduleDirectory, 'maintenance.generated.json'), 'utf8'),
  );
  const snippets = JSON.parse(
    await readFile(resolve(moduleDirectory, 'maintenance-snippets.generated.json'), 'utf8'),
  );
  assertMaintenanceSnippets(snippets);
  assert.deepEqual(snippets, await createMaintenanceSnippetArtifact(measurement.sourceRevision));
});

test('the base closure contains no source for future stages', async () => {
  const model = await createMaintenanceSourceModel();
  const base = model.stages[0];
  assert.equal(base.id, 'base-single-client');
  assert.deepEqual(base.sourceFiles, [HANDWRITTEN_STAGE_DEFINITIONS[0].sources[0].sourceFile]);
  assert.equal(base.sourceBlocks.length, 1);
  const source = base.sourceBlocks[0].code.toLowerCase();
  for (const forbidden of [
    'feature',
    'registry',
    'origin',
    'room',
    'route',
    'recipient',
    'select',
    'install',
    'broadcast',
    'target',
    'disconnect',
  ]) {
    assert.equal(source.includes(forbidden), false, `base source contains ${forbidden}`);
  }
});

test('the publication entry point validates every canonical artifact and cross-reference', async () => {
  const inputs = await loadPublicationInputs(root);
  const artifact = JSON.parse(
    await readFile(resolve(moduleDirectory, 'publication.generated.json'), 'utf8'),
  );
  assertPublicationArtifact(artifact, inputs);
});

test('the publication artifact is deterministic and rejects workflow drift', async () => {
  const inputs = await loadPublicationInputs(root);
  const first = createPublicationArtifact(inputs);
  const second = createPublicationArtifact(inputs);
  assert.deepEqual(first, second);

  const drifted = structuredClone(first);
  drifted.workflow.stepIds.pop();
  assert.throws(() => assertPublicationArtifact(drifted, inputs));
});

test('handwritten stage source contains no drawing-game answers or named fixtures', async () => {
  const model = await createMaintenanceSourceModel();
  const sourceFiles = new Set(model.stages.flatMap(({ sourceFiles }) => sourceFiles));
  for (const sourceFile of sourceFiles) {
    const source = await readFile(resolve(root, sourceFile), 'utf8');
    for (const forbidden of ["'A'", "'B'", "'C'", 'room-1', 'giraffe', 'zebra']) {
      assert.equal(source.includes(forbidden), false, `${sourceFile} contains ${forbidden}`);
    }
  }
  assert.deepEqual(
    model.stages.map(({ id }) => id),
    HANDWRITTEN_STAGE_IDS,
  );
});
