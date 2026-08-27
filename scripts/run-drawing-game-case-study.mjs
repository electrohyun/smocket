import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { createOracle, evaluateCard } from '../case-studies/drawing-game/evaluate.mjs';
import {
  CARD_TARGET_IDS,
  STEP_IDS,
  assertMeasurementArtifact,
} from '../case-studies/drawing-game/schema.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const prettierConfig = (await resolveConfig(join(repositoryRoot, 'package.json'))) ?? {};
const caseStudyRoot = join(repositoryRoot, 'case-studies', 'drawing-game');
const observationPath = join(caseStudyRoot, 'observations.generated.json');
const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const shouldCheck = args.includes('--check');
const targetOptionIndex = args.indexOf('--target');
const selectedTargetId = targetOptionIndex === -1 ? undefined : args[targetOptionIndex + 1];

const targetDefinitions = [
  { id: 'real', mode: 'workspace' },
  { id: 'smocket', mode: 'workspace' },
  { id: 'mock-socket', mode: 'isolated' },
  { id: 'msw-binding', mode: 'isolated' },
  { id: 'socket.io-mock', mode: 'isolated' },
];

const expectedArguments = [
  ...(shouldWrite ? ['--write'] : []),
  ...(shouldCheck ? ['--check'] : []),
  ...(selectedTargetId ? ['--target', selectedTargetId] : []),
];
if (
  args.length !== expectedArguments.length ||
  args.some((argument) => !expectedArguments.includes(argument)) ||
  Number(shouldWrite) + Number(shouldCheck) + Number(Boolean(selectedTargetId)) > 1
) {
  throw new Error(
    'Usage: node scripts/run-drawing-game-case-study.mjs [--write | --check | --target <real|smocket|mock-socket|msw-binding|socket.io-mock>]',
  );
}
if (selectedTargetId && !targetDefinitions.some(({ id }) => id === selectedTargetId)) {
  throw new Error(`Unknown drawing-game case-study target: ${selectedTargetId}`);
}

function run(command, commandArgs, cwd, capture = false) {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env, npm_config_update_notifier: 'false' };
    delete environment.npm_config_manage_package_manager_versions;
    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell
      ? ['/d', '/s', '/c', command, ...commandArgs]
      : commandArgs;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: environment,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => child.kill(), 30_000);

    if (capture) {
      child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk) => (errorOutput += chunk));
    }
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(output.trim());
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

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === '' || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..')
  );
}

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function describeFile(path) {
  const source = await readFile(join(repositoryRoot, path), 'utf8');
  return { path, sha256: sha256(source) };
}

async function runWorkspaceTarget(targetId) {
  const fixtureRoot = join(caseStudyRoot, 'fixtures', targetId);
  const probePath = join(fixtureRoot, 'probe.mjs');
  const commandArgs = [];
  if (targetId === 'smocket') {
    commandArgs.push(
      '--import',
      pathToFileURL(join(repositoryRoot, 'examples', 'drawing-game', 'smocket-substitution.mjs'))
        .href,
    );
  }
  commandArgs.push(probePath);
  return JSON.parse(await run(process.execPath, commandArgs, repositoryRoot, true));
}

async function runIsolatedTarget(targetId, temporaryRoot) {
  const fixtureRoot = join(caseStudyRoot, 'fixtures', targetId);
  const projectRoot = join(temporaryRoot, targetId);
  await mkdir(projectRoot, { recursive: true });
  for (const file of ['package.json', 'package-lock.json', 'probe.mjs']) {
    await copyFile(join(fixtureRoot, file), join(projectRoot, file));
  }

  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], projectRoot);
  const manifest = await readJson(join(projectRoot, 'package.json'));
  for (const [name, expectedVersion] of Object.entries(manifest.dependencies ?? {})) {
    assert.match(expectedVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    const installed = await readJson(join(projectRoot, 'node_modules', name, 'package.json'));
    assert.equal(installed.version, expectedVersion);
  }

  return JSON.parse(await run(process.execPath, ['probe.mjs'], projectRoot, true));
}

async function observeTarget(targetId, temporaryRoot) {
  const target = targetDefinitions.find(({ id }) => id === targetId);
  assert.ok(target);
  return target.mode === 'workspace'
    ? runWorkspaceTarget(targetId)
    : runIsolatedTarget(targetId, temporaryRoot);
}

function stableSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    caseStudy: snapshot.caseStudy,
    sourceRevision: snapshot.environment.smocketSourceCommit,
    workflow: snapshot.workflow,
    reproduction: snapshot.reproduction,
    sources: snapshot.sources,
    packageSources: snapshot.packageSources,
    oracle: snapshot.oracle,
    cards: snapshot.cards,
    claimBoundary: snapshot.claimBoundary,
  };
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
assert.ok(
  nodeMajor >= 20,
  `the drawing-game case study requires Node.js 20+, got ${process.version}`,
);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-drawing-game-case-study-'));
assert.equal(isInside(repositoryRoot, temporaryRoot), false);

try {
  const oracleRaw = await observeTarget('real', temporaryRoot);
  const oracle = createOracle(oracleRaw);
  const selectedCardIds = selectedTargetId
    ? selectedTargetId === 'real'
      ? []
      : [selectedTargetId]
    : CARD_TARGET_IDS;
  const cards = [];
  for (const targetId of selectedCardIds) {
    cards.push(evaluateCard(await observeTarget(targetId, temporaryRoot), oracle));
  }

  const snapshot = {
    schemaVersion: 1,
    caseStudy: 'drawing-game-compatibility',
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      npm: await run('npm', ['--version'], repositoryRoot, true),
      smocketSourceCommit: await run(
        'git',
        ['log', '-1', '--format=%H', '--', 'examples/drawing-game'],
        repositoryRoot,
        true,
      ),
      sourceState:
        'smocketSourceCommit identifies the committed golden workflow; per-file SHA-256 values identify the measurement inputs without a self-referential generated commit id.',
    },
    workflow: {
      source: 'examples/drawing-game',
      stepIds: STEP_IDS,
      oracleRule: 'Every expected step value is derived from the fresh Real Socket.IO observation.',
      nonReceiptRule: 'Use causal barrier/marker completion, never a short absence timeout.',
    },
    reproduction: {
      run: 'pnpm case-study:drawing-game',
      record: 'pnpm case-study:drawing-game:record',
      check: 'pnpm case-study:drawing-game:check',
      snippets: 'pnpm case-study:drawing-game:snippets',
      snippetsCheck: 'pnpm case-study:drawing-game:snippets:check',
      targets: Object.fromEntries(
        targetDefinitions.map(({ id }) => [
          id,
          `node scripts/run-drawing-game-case-study.mjs --target ${id}`,
        ]),
      ),
    },
    sources: {
      golden: await Promise.all(
        [
          'application.ts',
          'client.ts',
          'scenario.ts',
          'assertions.ts',
          'target.ts',
          'real.ts',
          'smocket.ts',
          'smocket-loader.mjs',
          'smocket-substitution.mjs',
          'package.json',
        ].map((file) => describeFile(`examples/drawing-game/${file}`)),
      ),
      measurement: await Promise.all(
        [
          'case-studies/drawing-game/schema.mjs',
          'case-studies/drawing-game/evaluate.mjs',
          'scripts/run-drawing-game-case-study.mjs',
          'package.json',
          'pnpm-lock.yaml',
          'packages/smocket-client/package.json',
        ].map(describeFile),
      ),
      fixtures: await Promise.all(
        [
          'real/probe.mjs',
          'smocket/probe.mjs',
          'mock-socket/probe.mjs',
          'mock-socket/package.json',
          'mock-socket/package-lock.json',
          'msw-binding/probe.mjs',
          'msw-binding/package.json',
          'msw-binding/package-lock.json',
          'socket.io-mock/probe.mjs',
          'socket.io-mock/package.json',
          'socket.io-mock/package-lock.json',
        ].map((file) => describeFile(`case-studies/drawing-game/fixtures/${file}`)),
      ),
    },
    packageSources: {
      real: [
        'https://www.npmjs.com/package/socket.io/v/4.8.3',
        'https://www.npmjs.com/package/socket.io-client/v/4.8.3',
      ],
      smocket: ['workspace source at environment.smocketSourceCommit'],
      'mock-socket': [
        'https://www.npmjs.com/package/mock-socket/v/9.3.1',
        'https://github.com/thoov/mock-socket',
      ],
      'msw-binding': [
        'https://www.npmjs.com/package/@mswjs/socket.io-binding/v/0.2.0',
        'https://www.npmjs.com/package/msw/v/2.15.0',
      ],
      'socket.io-mock': [
        'https://www.npmjs.com/package/socket.io-mock/v/1.3.2',
        'https://github.com/supremetechnopriest/socket.io-mock',
      ],
    },
    oracle,
    cards,
    claimBoundary:
      'These statuses apply only to the six recorded drawing-game steps and are not claims of overall library quality or Socket.IO compatibility.',
  };

  if (!selectedTargetId) assertMeasurementArtifact(snapshot);
  const serialized = await format(JSON.stringify(snapshot), {
    ...prettierConfig,
    parser: 'json',
  });

  if (shouldWrite) {
    await writeFile(observationPath, serialized);
    console.log(`wrote ${relative(repositoryRoot, observationPath)}`);
  } else if (shouldCheck) {
    const recorded = await readJson(observationPath);
    assertMeasurementArtifact(recorded);
    assert.deepEqual(stableSnapshot(snapshot), stableSnapshot(recorded));
    console.log('drawing-game case study matches the recorded observations');
  } else {
    process.stdout.write(serialized);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
