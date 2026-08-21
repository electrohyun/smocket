import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  MAINTENANCE_FEATURES,
  assertMaintenanceArtifact,
} from '../case-studies/drawing-game/maintenance-schema.mjs';
import {
  createMaintenanceSourceModel,
  repositoryRoot,
} from '../case-studies/drawing-game/maintenance-source.mjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const caseStudyRoot = resolve(scriptRoot, '../case-studies/drawing-game');
const artifactPath = join(caseStudyRoot, 'maintenance.generated.json');
const prettierConfig = (await resolveConfig(join(repositoryRoot, 'package.json'))) ?? {};
const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const shouldCheck = args.includes('--check');
if (
  args.length !== Number(shouldWrite) + Number(shouldCheck) ||
  Number(shouldWrite) + Number(shouldCheck) > 1
) {
  throw new Error('Usage: node scripts/run-drawing-game-maintenance.mjs [--write | --check]');
}

function run(command, commandArgs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (errorOutput += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolveRun(output.trim());
      else {
        reject(
          new Error(
            `${command} ${commandArgs.join(' ')} ${signal ? `was terminated by ${signal}` : `exited with code ${code}`}${errorOutput ? `\n${errorOutput}` : ''}`,
          ),
        );
      }
    });
  });
}

async function runProbe(targetId) {
  const commandArgs = [];
  if (targetId === 'smocket') {
    commandArgs.push(
      '--import',
      pathToFileURL(resolve(repositoryRoot, 'examples/drawing-game/smocket-substitution.mjs')).href,
    );
  }
  if (targetId === 'handwritten') {
    commandArgs.push(
      '--import',
      pathToFileURL(
        resolve(
          repositoryRoot,
          'case-studies/drawing-game/fixtures/handwritten/handwritten-substitution.mjs',
        ),
      ).href,
    );
  }
  commandArgs.push(
    resolve(
      caseStudyRoot,
      'fixtures',
      targetId === 'handwritten' ? 'handwritten' : targetId,
      'probe.mjs',
    ),
  );
  return JSON.parse(await run(process.execPath, commandArgs));
}

function lineReferences(blocks) {
  return blocks.flatMap((block) =>
    block.countedLineNumbers.map((line) => ({ sourceFile: block.sourceFile, line })),
  );
}

async function describeFile(sourceFile) {
  const source = await readFile(resolve(repositoryRoot, sourceFile), 'utf8');
  return {
    sourceFile,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
}

function summarizeCountedFiles(category, blocks) {
  const files = new Map();
  for (const block of blocks) {
    const current = files.get(block.sourceFile) ?? { blocks: [], lines: new Set() };
    current.blocks.push(block.id);
    for (const line of block.countedLineNumbers) current.lines.add(line);
    files.set(block.sourceFile, current);
  }
  return [...files].map(([sourceFile, value]) => ({
    sourceFile,
    category,
    blockIds: value.blocks,
    loc: value.lines.size,
    countedLineNumbers: [...value.lines].sort((left, right) => left - right),
  }));
}

async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'dist' && entry.name !== 'node_modules') {
        files.push(...(await listSourceFiles(path)));
      }
    } else {
      files.push(relative(repositoryRoot, path).replaceAll('\\', '/'));
    }
  }
  return files;
}

function exclusionReason(sourceFile) {
  if (sourceFile.endsWith('.generated.json')) return 'Generated output is not counted.';
  if (sourceFile.endsWith('package-lock.json') || sourceFile === 'pnpm-lock.yaml') {
    return 'Lockfiles are not counted.';
  }
  if (sourceFile.endsWith('README.md')) return 'Documentation is not counted.';
  if (sourceFile.includes('/fixtures/handwritten/stages.mjs')) {
    return 'Stage scenarios and assertions are not counted.';
  }
  if (sourceFile.includes('/fixtures/handwritten/probe.mjs')) {
    return 'Target validation and observation code is not counted.';
  }
  if (sourceFile.includes('/fixtures/real/') || sourceFile.includes('/fixtures/smocket/')) {
    return 'Oracle and target probes are not application-owned delivery support.';
  }
  if (
    sourceFile.includes('/fixtures/mock-socket/') ||
    sourceFile.includes('/fixtures/msw-binding/') ||
    sourceFile.includes('/fixtures/socket.io-mock/')
  ) {
    return 'Other public-tool fixtures are outside this two-target maintenance comparison.';
  }
  if (
    sourceFile.endsWith('scenario.ts') ||
    sourceFile.endsWith('assertions.ts') ||
    sourceFile.endsWith('dual-target.test.ts') ||
    sourceFile.endsWith('case-study.test.mjs')
  ) {
    return 'Scenarios, assertions, and tests are not counted.';
  }
  if (sourceFile.endsWith('target.ts') || sourceFile.endsWith('observe.ts')) {
    return 'Observation and lifecycle harness code is not counted.';
  }
  if (sourceFile.endsWith('real.ts')) return 'Real Socket.IO is the oracle, not a compared target.';
  if (
    sourceFile.endsWith('schema.mjs') ||
    sourceFile.endsWith('evaluate.mjs') ||
    sourceFile.startsWith('scripts/')
  ) {
    return 'Measurement and generation tooling is not counted.';
  }
  if (
    sourceFile.endsWith('package.json') ||
    sourceFile.includes('tsconfig') ||
    sourceFile.endsWith('smocket-loader.mjs') ||
    sourceFile.endsWith('smocket-substitution.mjs')
  ) {
    return 'Build configuration or source outside the selected counted regions is not counted.';
  }
  return 'Source outside the selected application-owned delivery regions is not counted.';
}

async function createExcludedFiles(countedFiles) {
  const scoped = new Set([
    ...(await listSourceFiles(resolve(repositoryRoot, 'examples/drawing-game'))),
    ...(await listSourceFiles(caseStudyRoot)),
    'scripts/run-drawing-game-case-study.mjs',
    'scripts/drawing-game-case-study-snippets.mjs',
    'scripts/drawing-game-snippets.mjs',
    'scripts/run-drawing-game-maintenance.mjs',
    'scripts/drawing-game-maintenance-snippets.mjs',
    'case-studies/drawing-game/maintenance.generated.json',
    'case-studies/drawing-game/maintenance-snippets.generated.json',
    'package.json',
    'pnpm-lock.yaml',
    'packages/smocket-client/package.json',
  ]);
  const counted = new Set(countedFiles.map(({ sourceFile }) => sourceFile));
  return [...scoped]
    .filter((sourceFile) => !counted.has(sourceFile))
    .sort()
    .map((sourceFile) => ({ sourceFile, reason: exclusionReason(sourceFile) }));
}

const real = await runProbe('real');
const smocket = await runProbe('smocket');
const handwritten = await runProbe('handwritten');
assert.equal(real.targetId, 'real');
assert.equal(smocket.targetId, 'smocket');
assert.equal(handwritten.targetId, 'handwritten');
assert.deepEqual(smocket.observation, real.observation);
assert.deepEqual(handwritten.observation, real.observation);

const sourceRevision = await run('git', [
  'log',
  '-1',
  '--format=%H',
  '--',
  'examples/drawing-game',
]);
const sourceModel = await createMaintenanceSourceModel();
const handwrittenBlocks = [...sourceModel.handwrittenByFeature.values()].flat();
const countedFiles = [
  ...summarizeCountedFiles('shared-application', sourceModel.sharedApplication),
  ...summarizeCountedFiles('smocket-integration', sourceModel.smocketIntegration),
  ...summarizeCountedFiles('handwritten-support', handwrittenBlocks),
];
const excludedFiles = await createExcludedFiles(countedFiles);
const sourceInputs = await Promise.all(
  [
    'package.json',
    'pnpm-lock.yaml',
    'examples/drawing-game/application.ts',
    'examples/drawing-game/client.ts',
    'examples/drawing-game/scenario.ts',
    'examples/drawing-game/assertions.ts',
    'examples/drawing-game/target.ts',
    'examples/drawing-game/real.ts',
    'examples/drawing-game/smocket.ts',
    'examples/drawing-game/smocket-loader.mjs',
    'examples/drawing-game/smocket-substitution.mjs',
    'case-studies/drawing-game/fixtures/real/probe.mjs',
    'case-studies/drawing-game/fixtures/smocket/probe.mjs',
    'case-studies/drawing-game/fixtures/handwritten/handwritten-socket.mjs',
    'case-studies/drawing-game/fixtures/handwritten/handwritten-loader.mjs',
    'case-studies/drawing-game/fixtures/handwritten/handwritten-substitution.mjs',
    'case-studies/drawing-game/fixtures/handwritten/bootstrap.mjs',
    'case-studies/drawing-game/fixtures/handwritten/stages.mjs',
    'case-studies/drawing-game/fixtures/handwritten/probe.mjs',
    'case-studies/drawing-game/maintenance-schema.mjs',
    'case-studies/drawing-game/maintenance-source.mjs',
    'scripts/run-drawing-game-maintenance.mjs',
    'scripts/drawing-game-maintenance-snippets.mjs',
  ].map(describeFile),
);
const sharedLineReferences = lineReferences(sourceModel.sharedApplication);
let smocketCumulative = 0;
let handwrittenCumulative = 0;

const features = MAINTENANCE_FEATURES.map((definition) => {
  const smocketBlocks =
    definition.id === 'base-single-client' ? sourceModel.smocketIntegration : [];
  const handwrittenFeatureBlocks = sourceModel.handwrittenByFeature.get(definition.id);
  const smocketDelta = smocketBlocks.reduce((sum, block) => sum + block.loc, 0);
  const handwrittenDelta = handwrittenFeatureBlocks.reduce((sum, block) => sum + block.loc, 0);
  smocketCumulative += smocketDelta;
  handwrittenCumulative += handwrittenDelta;
  const stage = handwritten.stages.find(({ id }) => id === definition.id);
  assert.ok(stage, `missing executed handwritten stage ${definition.id}`);

  return {
    ...definition,
    validation: stage,
    targets: {
      smocket: {
        provider:
          definition.id === 'base-single-client'
            ? 'Application-owned bootstrap and package substitution.'
            : 'The Smocket package supplies this delivery semantic; no feature-specific integration source is added.',
        deltaLoc: smocketDelta,
        deltaLabel: `+${smocketDelta} lines`,
        cumulativeLoc: smocketCumulative,
        sourceBlocks: smocketBlocks,
      },
      handwritten: {
        provider: 'The application owns and executes this transport support.',
        deltaLoc: handwrittenDelta,
        deltaLabel: `+${handwrittenDelta} lines`,
        cumulativeLoc: handwrittenCumulative,
        sourceBlocks: handwrittenFeatureBlocks,
      },
    },
  };
});

const artifact = {
  schemaVersion: 1,
  caseStudy: 'drawing-game-maintenance-surface',
  sourceRevision,
  question: {
    targets: ['smocket', 'handwritten'],
    realSocketIoRole: 'behavior-oracle-only',
    selectedWorkflow: 'examples/drawing-game',
  },
  measurementRules: {
    headline: 'Application-owned Socket.IO delivery support used by this workflow.',
    sharedApplicationCountedAsDifference: false,
    sourceFormatting: 'Prettier-formatted checked-in source.',
    countedLine:
      'A nonblank source line containing code after comment-only and punctuation-only lines are removed.',
    excludedLineKinds: ['blank', 'comment-only', 'snippet-marker', 'punctuation-only formatting'],
    excludedArtifacts: [
      'tests',
      'scenarios and assertions',
      'generated JSON',
      'lockfiles',
      'README files',
    ],
    selectionRule:
      'Always include base, close prerequisites through requires, then sum each selected feature delta once.',
  },
  sharedApplication: {
    role: 'Used unchanged by both targets and excluded from the headline difference.',
    loc: sharedLineReferences.length,
    files: sourceModel.sharedApplication,
    countedLineNumbers: sharedLineReferences,
  },
  countedFiles,
  excludedFiles,
  sourceInputs,
  features,
  stages: handwritten.stages,
  finalWorkflow: {
    markerRule:
      'Each absence check crosses a same-client client-to-server barrier before the server emits its marker.',
    realVsSmocketDeepEqual: true,
    realVsHandwrittenDeepEqual: true,
    repeatedRunMatches: {
      real: real.repeatedRunMatches,
      smocket: smocket.repeatedRunMatches,
      handwritten: handwritten.repeatedRunMatches,
    },
    observations: {
      real: real.observation,
      smocket: smocket.observation,
      handwritten: handwritten.observation,
    },
  },
  interpretation: [
    'For one client and one configured response, the handwritten transport is small and direct.',
    'The added source belongs to client identity and Socket.IO delivery semantics, not drawing or chat domain logic.',
    'LOC describes an application-owned maintenance surface; it does not measure development time, productivity, reliability, or code quality.',
    'Smocket adds no feature-specific integration lines after bootstrap because the package owns these selected semantics; this is not a universal recommendation.',
  ],
  limitations: [
    'The result applies only to this drawing-game workflow, feature order, and line-count rule.',
    'The handwritten transport implements only the Socket.IO surface exercised here and is not a general Socket.IO replacement.',
    'Real Socket.IO supplies expected behavior only and is not included in the convenience LOC comparison.',
  ],
  reproduction: {
    observe: 'pnpm case-study:drawing-game:maintenance',
    record: 'pnpm case-study:drawing-game:maintenance:record',
    check: 'pnpm case-study:drawing-game:maintenance:check',
    handwritten: 'pnpm case-study:drawing-game:maintenance:handwritten',
    snippets: 'pnpm case-study:drawing-game:maintenance:snippets',
    snippetsCheck: 'pnpm case-study:drawing-game:maintenance:snippets:check',
  },
};

assertMaintenanceArtifact(artifact);
const serialized = await format(JSON.stringify(artifact), {
  ...prettierConfig,
  parser: 'json',
});

if (shouldWrite) {
  await writeFile(artifactPath, serialized);
  console.log(`wrote ${relative(repositoryRoot, artifactPath)}`);
} else if (shouldCheck) {
  const current = await readFile(artifactPath, 'utf8');
  assert.equal(
    current,
    serialized,
    'Maintenance artifact is stale. Regenerate with: pnpm case-study:drawing-game:maintenance:record',
  );
  console.log('drawing-game maintenance artifact is current');
} else {
  process.stdout.write(serialized);
}
