import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  HANDWRITTEN_STAGE_DEFINITIONS,
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
  commandArgs.push(resolve(caseStudyRoot, 'fixtures', targetId, 'probe.mjs'));
  return JSON.parse(await run(process.execPath, commandArgs));
}

async function describeFile(sourceFile) {
  const source = await readFile(resolve(repositoryRoot, sourceFile), 'utf8');
  return {
    sourceFile,
    sha256: createHash('sha256').update(source).digest('hex'),
  };
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
  if (sourceFile.endsWith('.md')) return 'Documentation is not counted.';
  if (sourceFile.endsWith('stages.mjs') || sourceFile.endsWith('probe.mjs')) {
    return 'Stage execution and observation harnesses are not counted.';
  }
  if (sourceFile.includes('/fixtures/real/') || sourceFile.includes('/fixtures/smocket/')) {
    return 'Oracle and target probes are not application-owned delivery support.';
  }
  if (
    sourceFile.includes('/fixtures/mock-socket/') ||
    sourceFile.includes('/fixtures/msw-binding/') ||
    sourceFile.includes('/fixtures/socket.io-mock/')
  ) {
    return 'Previously recorded public-tool fixtures are outside this maintenance comparison.';
  }
  if (
    sourceFile.endsWith('scenario.ts') ||
    sourceFile.endsWith('assertions.ts') ||
    sourceFile.endsWith('target.ts') ||
    sourceFile.endsWith('dual-target.test.ts') ||
    sourceFile.endsWith('case-study.test.mjs')
  ) {
    return 'Scenarios, lifecycle harnesses, assertions, and tests are not counted.';
  }
  if (sourceFile.endsWith('real.ts')) return 'Real Socket.IO is the oracle, not a compared target.';
  if (
    sourceFile.endsWith('schema.mjs') ||
    sourceFile.endsWith('evaluate.mjs') ||
    sourceFile.startsWith('scripts/')
  ) {
    return 'Measurement and generation tooling is not counted.';
  }
  if (sourceFile.endsWith('package.json') || sourceFile.includes('tsconfig')) {
    return 'Build configuration is not counted.';
  }
  return 'Source outside the selected executable closure is not counted.';
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
assert.deepEqual(
  handwritten.stages.map(({ id }) => id),
  HANDWRITTEN_STAGE_DEFINITIONS.map(({ id }) => id),
);

const stages = sourceModel.stages.map((stage, index) => ({
  id: stage.id,
  label: stage.label,
  prerequisite: stage.prerequisite,
  sourceFiles: stage.sourceFiles,
  sourceHash: stage.sourceHash,
  totalLoc: stage.totalLoc,
  change: stage.change,
  sourceBlocks: stage.sourceBlocks,
  diffBlocks: stage.diffBlocks,
  validation: handwritten.stages[index],
}));
const countedFiles = [
  ...sourceModel.sharedApplication.map((block) => ({
    sourceFile: block.sourceFile,
    category: 'shared-application',
    stageIds: [],
    loc: block.loc,
    countedLineNumbers: block.countedLineNumbers,
  })),
  ...sourceModel.smocketIntegration.map((block) => ({
    sourceFile: block.sourceFile,
    category: 'smocket-integration',
    stageIds: [],
    loc: block.loc,
    countedLineNumbers: block.countedLineNumbers,
  })),
  ...sourceModel.stages.flatMap((stage) =>
    stage.sourceBlocks.map((block) => ({
      sourceFile: block.sourceFile,
      category: 'handwritten-stage-source',
      stageIds: [stage.id],
      loc: block.loc,
      countedLineNumbers: block.countedLineNumbers,
    })),
  ),
];
const excludedFiles = await createExcludedFiles(countedFiles);
const modelSourceFiles = [
  ...sourceModel.goldenFiles,
  ...sourceModel.sharedApplication.map(({ sourceFile }) => sourceFile),
  ...sourceModel.smocketIntegration.map(({ sourceFile }) => sourceFile),
  ...sourceModel.stages.flatMap(({ sourceFiles }) => sourceFiles),
];
const sourceInputs = await Promise.all(
  [
    ...new Set([
      'package.json',
      'pnpm-lock.yaml',
      'examples/drawing-game/package.json',
      'packages/smocket-client/package.json',
      ...modelSourceFiles,
      'examples/drawing-game/assertions.ts',
      'examples/drawing-game/target.ts',
      'examples/drawing-game/real.ts',
      'case-studies/drawing-game/fixtures/real/probe.mjs',
      'case-studies/drawing-game/fixtures/smocket/probe.mjs',
      'case-studies/drawing-game/fixtures/handwritten/stages.mjs',
      'case-studies/drawing-game/fixtures/handwritten/probe.mjs',
      'case-studies/drawing-game/case-study.test.mjs',
      'case-studies/drawing-game/maintenance-schema.mjs',
      'case-studies/drawing-game/maintenance-source.mjs',
      'scripts/run-drawing-game-maintenance.mjs',
      'scripts/drawing-game-maintenance-snippets.mjs',
    ]),
  ].map(describeFile),
);

function reconcileBlockLoc(blocks, category) {
  const countedByFile = new Map();
  for (const block of blocks) {
    const counted = countedByFile.get(block.sourceFile) ?? new Set();
    for (const line of block.countedLineNumbers) counted.add(line);
    countedByFile.set(block.sourceFile, counted);
  }
  const summedLoc = blocks.reduce((sum, block) => sum + block.loc, 0);
  const uniqueLoc = [...countedByFile.values()].reduce((sum, lines) => sum + lines.size, 0);
  assert.equal(summedLoc, uniqueLoc, `${category} source blocks contain overlapping counted lines`);
  return summedLoc;
}

const sharedApplicationLoc = reconcileBlockLoc(sourceModel.sharedApplication, 'shared application');
const smocketIntegrationLoc = reconcileBlockLoc(
  sourceModel.smocketIntegration,
  'Smocket integration',
);
const base = stages[0];
const full = stages.at(-1);

const artifact = {
  schemaVersion: 2,
  caseStudy: 'drawing-game-maintenance-surface',
  sourceRevision,
  question: {
    targets: ['smocket', 'handwritten'],
    realSocketIoRole: 'behavior-oracle-only',
    selectedWorkflow: 'examples/drawing-game',
    measuredChange:
      'Executable application-owned support as a handwritten fake grows from one response to the unchanged golden workflow.',
  },
  measurementRules: {
    sharedApplicationCountedAsDifference: false,
    sourceFormatting: 'Prettier-formatted checked-in source.',
    countedLine:
      'A nonblank source line containing code after comment-only and punctuation-only lines are removed.',
    stageClosure:
      'Only the source files imported by that independently executed stage are included in its total.',
    transitionDiff:
      'Additions and deletions are an LCS diff over counted code lines grouped by stable source role.',
    invariant: 'previous total + additions - deletions = current total',
  },
  sharedApplication: {
    role: 'Used unchanged by both targets and excluded from the maintenance difference.',
    loc: sharedApplicationLoc,
    sourceBlocks: sourceModel.sharedApplication,
  },
  smocketIntegration: {
    role: 'Canonical golden bootstrap and package substitution; Real Socket.IO is not scored.',
    totalLoc: smocketIntegrationLoc,
    sourceBlocks: sourceModel.smocketIntegration,
  },
  stages,
  countedFiles,
  excludedFiles,
  sourceInputs,
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
    `The minimal one-pair fake is ${base.totalLoc} counted LOC and contains no source for later routing or lifecycle stages.`,
    `Growing to the unchanged golden workflow reaches ${full.totalLoc} counted LOC after recording both additions and removals at every transition.`,
    'A transition with deletions represents real rewriting or a structural change rather than hidden cumulative scaffolding.',
    'The recorded numbers are generated from executable source closures; they are not adjusted to support a preferred narrative.',
    'LOC describes an application-owned maintenance surface; it does not prove time, productivity, reliability, or code quality.',
  ],
  limitations: [
    'The result applies only to this drawing-game workflow, stage order, implementation choices, and line-count rule.',
    'Each handwritten stage is deliberately limited to the behavior reached at that point and is not a general Socket.IO replacement.',
    'Real Socket.IO supplies expected behavior only and is not included in the convenience LOC comparison.',
    'Source diff size describes checked-in maintenance surface, not the effort or skill required to author it.',
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
