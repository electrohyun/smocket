import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  HANDWRITTEN_STAGE_IDS,
  assertMaintenanceArtifact,
  assertMaintenanceSnippets,
} from './maintenance-schema.mjs';
import { STEP_IDS, TARGET_IDS, assertMeasurementArtifact } from './schema.mjs';

export const PUBLICATION_ARTIFACT_DEFINITIONS = [
  {
    id: 'golden-snippets',
    path: 'examples/drawing-game/snippets.generated.json',
    purpose: 'Executable TypeScript application and target-bootstrap snippets.',
  },
  {
    id: 'comparison-observations',
    path: 'case-studies/drawing-game/observations.generated.json',
    purpose: 'Real oracle and Smocket or competitor step results.',
  },
  {
    id: 'comparison-snippets',
    path: 'case-studies/drawing-game/snippets.generated.json',
    purpose: 'Executable source snippets indexed by target and workflow step.',
  },
  {
    id: 'maintenance-measurement',
    path: 'case-studies/drawing-game/maintenance.generated.json',
    purpose: 'Staged handwritten LOC, diffs, source closures, and assertions.',
  },
  {
    id: 'maintenance-snippets',
    path: 'case-studies/drawing-game/maintenance-snippets.generated.json',
    purpose: 'Executable handwritten stage and Smocket integration snippets.',
  },
];

const commands = {
  record: 'pnpm case-study:drawing-game:publication:record',
  check: 'pnpm case-study:drawing-game:publication:check',
  validate: 'pnpm case-study:drawing-game:publication:validate',
};

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function assertObject(value, message) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), message);
}

function uniqueIds(entries, owner) {
  const ids = entries.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, `${owner} ids must be unique`);
  return ids;
}

function assertGoldenSnippets(artifact) {
  assertObject(artifact, 'golden snippets are required');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.regenerateWith, 'pnpm example:drawing-game:snippets');
  const ids = uniqueIds(artifact.snippets, 'golden snippet');
  for (const snippet of artifact.snippets) {
    assert.equal(typeof snippet.sourceFile, 'string');
    assert.equal(typeof snippet.language, 'string');
    assert.equal(typeof snippet.purpose, 'string');
    assert.equal(typeof snippet.code, 'string');
    assert.ok(Array.isArray(snippet.stepIds));
    assert.ok(snippet.stepIds.length > 0, `${snippet.id} must reference a workflow step`);
    assert.equal(new Set(snippet.stepIds).size, snippet.stepIds.length);
    assert.ok(snippet.stepIds.every((stepId) => STEP_IDS.includes(stepId)));
  }
  for (const stepId of STEP_IDS) {
    assert.ok(
      artifact.snippets.some((snippet) => snippet.stepIds.includes(stepId)),
      `golden snippets do not cover ${stepId}`,
    );
  }
  return ids;
}

function assertComparisonSnippets(artifact, observations) {
  assertObject(artifact, 'comparison snippets are required');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.sourceRevision, observations.environment.smocketSourceCommit);
  const ids = uniqueIds(artifact.snippets, 'comparison snippet');
  const cardByTarget = new Map(observations.cards.map((card) => [card.targetId, card]));
  for (const targetId of TARGET_IDS) {
    for (const stepId of STEP_IDS) {
      const matches = artifact.snippets.filter(
        (snippet) => snippet.targetId === targetId && snippet.stepId === stepId,
      );
      assert.ok(matches.length >= 1, `missing comparison snippet for ${targetId}/${stepId}`);
      const expectedStatus =
        targetId === 'real'
          ? 'ORACLE'
          : cardByTarget.get(targetId).steps.find((step) => step.stepId === stepId).status;
      assert.ok(
        matches.every((snippet) => snippet.status === expectedStatus),
        `comparison snippet status drift for ${targetId}/${stepId}`,
      );
    }
  }
  for (const snippet of artifact.snippets) {
    assert.ok(TARGET_IDS.includes(snippet.targetId));
    assert.ok(STEP_IDS.includes(snippet.stepId));
    assert.equal(sha256(snippet.code), snippet.sourceSha256);
  }
  return ids;
}

export async function loadPublicationInputs(repositoryRoot) {
  const entries = await Promise.all(
    PUBLICATION_ARTIFACT_DEFINITIONS.map(async (definition) => {
      const source = await readFile(resolve(repositoryRoot, definition.path), 'utf8');
      return [
        definition.id,
        { ...definition, source, sha256: sha256(source), value: JSON.parse(source) },
      ];
    }),
  );
  return Object.fromEntries(entries);
}

function validateInputs(inputs) {
  for (const definition of PUBLICATION_ARTIFACT_DEFINITIONS) {
    assertObject(inputs[definition.id], `missing publication input ${definition.id}`);
  }

  const goldenSnippets = inputs['golden-snippets'].value;
  const observations = inputs['comparison-observations'].value;
  const comparisonSnippets = inputs['comparison-snippets'].value;
  const maintenance = inputs['maintenance-measurement'].value;
  const maintenanceSnippets = inputs['maintenance-snippets'].value;

  assertMeasurementArtifact(observations);
  assertMaintenanceArtifact(maintenance);
  assertMaintenanceSnippets(maintenanceSnippets);
  assertGoldenSnippets(goldenSnippets);
  assertComparisonSnippets(comparisonSnippets, observations);

  const sourceRevision = observations.environment.smocketSourceCommit;
  assert.equal(comparisonSnippets.sourceRevision, sourceRevision);
  assert.equal(maintenance.sourceRevision, sourceRevision);
  assert.equal(maintenanceSnippets.sourceRevision, sourceRevision);
  assert.deepEqual(observations.workflow.stepIds, STEP_IDS);
  assert.deepEqual(maintenanceSnippets.stageIds, HANDWRITTEN_STAGE_IDS);
  assert.deepEqual(
    maintenance.stages.map(({ id }) => id),
    HANDWRITTEN_STAGE_IDS,
  );

  return { goldenSnippets, observations, comparisonSnippets, maintenance, maintenanceSnippets };
}

function reference(artifactId, jsonPointer) {
  return { artifactId, jsonPointer };
}

function resolveJsonPointer(value, pointer) {
  if (pointer === '') return value;
  assert.match(pointer, /^\//, `invalid JSON pointer ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, part) => {
      assert.ok(current !== null && current !== undefined && part in Object(current));
      return current[part];
    }, value);
}

function assertReferences(value, inputs) {
  if (!value || typeof value !== 'object') return;
  if (
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    typeof value.artifactId === 'string' &&
    typeof value.jsonPointer === 'string'
  ) {
    const input = inputs[value.artifactId];
    assertObject(input, `unknown publication artifact ${value.artifactId}`);
    assert.notEqual(resolveJsonPointer(input.value, value.jsonPointer), undefined);
    return;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertReferences(child, inputs);
  }
}

function targetResultPointer(targetId, cards) {
  if (targetId === 'real') return '/oracle';
  return `/cards/${cards.findIndex((card) => card.targetId === targetId)}`;
}

function stepResultPointer(targetId, stepId, cards) {
  if (targetId === 'real') return `/oracle/steps/${stepId}`;
  const cardIndex = cards.findIndex((card) => card.targetId === targetId);
  const stepIndex = cards[cardIndex].steps.findIndex((step) => step.stepId === stepId);
  return `/cards/${cardIndex}/steps/${stepIndex}`;
}

export function createPublicationArtifact(inputs) {
  const { goldenSnippets, observations, comparisonSnippets, maintenance, maintenanceSnippets } =
    validateInputs(inputs);
  const goldenByStep = new Map(
    STEP_IDS.map((stepId) => [
      stepId,
      goldenSnippets.snippets
        .filter((snippet) => snippet.stepIds.includes(stepId))
        .map(({ id }) => id),
    ]),
  );
  const comparisonByStep = new Map(
    STEP_IDS.map((stepId) => [
      stepId,
      comparisonSnippets.snippets
        .filter((snippet) => snippet.stepId === stepId)
        .map(({ id }) => id),
    ]),
  );
  const sourceRevision = observations.environment.smocketSourceCommit;
  const allTargets = [observations.oracle, ...observations.cards];

  return {
    schemaVersion: 1,
    publication: 'drawing-game',
    sourceRevision,
    commands,
    canonicalArtifacts: PUBLICATION_ARTIFACT_DEFINITIONS.map((definition) => ({
      ...definition,
      schemaVersion: inputs[definition.id].value.schemaVersion,
      sha256: inputs[definition.id].sha256,
    })),
    workflow: {
      definition: reference('comparison-observations', '/workflow'),
      stepIds: STEP_IDS,
      steps: STEP_IDS.map((stepId) => {
        const realSnippet = comparisonSnippets.snippets.find(
          (snippet) => snippet.targetId === 'real' && snippet.stepId === stepId,
        );
        return {
          id: stepId,
          purpose: realSnippet.purpose,
          oracle: reference('comparison-observations', `/oracle/steps/${stepId}`),
          goldenSnippetIds: goldenByStep.get(stepId),
          comparisonSnippetIds: comparisonByStep.get(stepId),
        };
      }),
      targets: TARGET_IDS.map((targetId) => {
        const target = allTargets.find((entry) => entry.targetId === targetId);
        return {
          id: targetId,
          label: target.label,
          role:
            targetId === 'real'
              ? 'behavior-oracle'
              : targetId === 'smocket'
                ? 'subject'
                : 'competitor',
          packages: target.packages,
          result: reference(
            'comparison-observations',
            targetResultPointer(targetId, observations.cards),
          ),
          packageSources: reference('comparison-observations', `/packageSources/${targetId}`),
          steps: STEP_IDS.map((stepId) => {
            const measured =
              targetId === 'real'
                ? { status: 'ORACLE' }
                : target.steps.find((step) => step.stepId === stepId);
            return {
              stepId,
              status: measured.status,
              ...(measured.reason ? { reason: measured.reason } : {}),
              ...(measured.blockedByStepId ? { blockedByStepId: measured.blockedByStepId } : {}),
              result: reference(
                'comparison-observations',
                stepResultPointer(targetId, stepId, observations.cards),
              ),
              snippetIds: comparisonSnippets.snippets
                .filter((snippet) => snippet.targetId === targetId && snippet.stepId === stepId)
                .map(({ id }) => id),
            };
          }),
        };
      }),
      classificationRules: {
        ORACLE: 'Expected values come from the executed Real Socket.IO workflow.',
        MATCH: 'The public API ran and its normalized result equals the oracle.',
        DIFFERENT: 'The public API ran and its normalized result differs from the oracle.',
        UNSUPPORTED:
          'The required concept or public API is absent; no replacement behavior is added.',
        BLOCKED: 'An earlier non-matching step prevents this step from executing.',
        applicationOwned:
          'Handwritten stages are application-owned implementations, not package support or competitor results.',
      },
    },
    maintenance: {
      role: 'application-owned-supplement',
      definition: reference('maintenance-measurement', ''),
      question: maintenance.question,
      measurementRules: maintenance.measurementRules,
      sharedApplicationLoc: maintenance.sharedApplication.loc,
      smocketIntegrationLoc: maintenance.smocketIntegration.totalLoc,
      smocketSnippetIds: maintenanceSnippets.snippets
        .filter(({ owner }) => owner === 'smocket')
        .map(({ id }) => id),
      stageIds: HANDWRITTEN_STAGE_IDS,
      stages: maintenance.stages.map((stage, index) => ({
        id: stage.id,
        label: stage.label,
        prerequisite: stage.prerequisite,
        sourceFiles: stage.sourceFiles,
        totalLoc: stage.totalLoc,
        change: stage.change,
        result: reference('maintenance-measurement', `/stages/${index}`),
        snippetIds: maintenanceSnippets.snippets
          .filter((snippet) => snippet.stageId === stage.id)
          .map(({ id }) => id),
      })),
      finalWorkflow: {
        realVsSmocketDeepEqual: maintenance.finalWorkflow.realVsSmocketDeepEqual,
        realVsHandwrittenDeepEqual: maintenance.finalWorkflow.realVsHandwrittenDeepEqual,
        repeatedRunMatches: maintenance.finalWorkflow.repeatedRunMatches,
        observations: reference('maintenance-measurement', '/finalWorkflow/observations'),
      },
      interpretation: maintenance.interpretation,
      limitations: maintenance.limitations,
    },
    snippets: {
      catalogs: [
        {
          id: 'golden',
          artifactId: 'golden-snippets',
          snippetIds: goldenSnippets.snippets.map(({ id }) => id),
        },
        {
          id: 'comparison',
          artifactId: 'comparison-snippets',
          snippetIds: comparisonSnippets.snippets.map(({ id }) => id),
        },
        {
          id: 'maintenance',
          artifactId: 'maintenance-snippets',
          snippetIds: maintenanceSnippets.snippets.map(({ id }) => id),
        },
      ],
    },
    provenance: {
      sourceRevision,
      sourceFiles: [
        reference('comparison-observations', '/sources'),
        reference('maintenance-measurement', '/sourceInputs'),
      ],
      packageVersions: [
        reference('comparison-observations', '/oracle/packages'),
        reference('comparison-observations', '/cards'),
      ],
    },
    claimBoundaries: {
      workflow: observations.claimBoundary,
      maintenance: reference('maintenance-measurement', '/limitations'),
    },
  };
}

export function assertPublicationArtifact(artifact, inputs) {
  assertObject(artifact, 'publication artifact is required');
  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.publication, 'drawing-game');
  assert.deepEqual(artifact, createPublicationArtifact(inputs));
  assertReferences(artifact, inputs);
  return artifact;
}
