import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const caseStudyRoot = join(repositoryRoot, 'case-studies', 'chat-room');
const exampleRoot = join(repositoryRoot, 'examples', 'chat-room');
const observationPath = join(caseStudyRoot, 'observations.json');
const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const shouldCheck = args.includes('--check');
const targetOptionIndex = args.indexOf('--target');
const selectedTargetId = targetOptionIndex === -1 ? undefined : args[targetOptionIndex + 1];

const applicationFiles = ['app.js', 'scenario.js', 'assertions.js'];
const targets = [
  {
    id: 'socket-io',
    label: 'Real Socket.IO',
    files: [{ name: 'bootstrap.js', role: 'bootstrap' }],
  },
  {
    id: 'published-smocket',
    label: 'Exact published Smocket',
    files: [{ name: 'bootstrap.js', role: 'bootstrap' }],
  },
  {
    id: 'handwritten',
    label: 'Handwritten mock',
    files: [
      { name: 'bootstrap.js', role: 'bootstrap' },
      { name: 'handwritten-socket-io.js', role: 'mock implementation' },
    ],
  },
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
    'Usage: node scripts/run-chat-room-case-study.mjs [--write | --check | --target <socket-io|published-smocket|handwritten>]',
  );
}

const selectedTargets = selectedTargetId
  ? targets.filter(({ id }) => id === selectedTargetId)
  : targets;
if (selectedTargets.length === 0) throw new Error(`Unknown case-study target: ${selectedTargetId}`);

function run(command, args, cwd, capture = false) {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env, npm_config_update_notifier: 'false' };
    delete environment.npm_config_manage_package_manager_versions;

    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let output = '';

    if (capture) child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve(output.trim());
      else {
        reject(
          new Error(
            signal
              ? `${command} was terminated by ${signal}`
              : `${command} exited with code ${code}`,
          ),
        );
      }
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === '' || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..')
  );
}

function countLines(source) {
  if (source.length === 0) return 0;
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

async function describeFile(root, path, role) {
  const source = await readFile(join(root, path), 'utf8');
  return { path, role, lines: countLines(source), sha256: sha256(source) };
}

async function describeApplication() {
  const files = await Promise.all(
    applicationFiles.map((path) =>
      describeFile(exampleRoot, path, path === 'assertions.js' ? 'assertions' : 'application'),
    ),
  );
  const combinedSource = files.map(({ path, sha256: hash }) => `${path}\0${hash}`).join('\n');

  return {
    source: 'examples/chat-room',
    files,
    combinedSha256: sha256(combinedSource),
  };
}

async function assembleTarget(target, projectRoot) {
  const fixtureRoot = join(caseStudyRoot, 'fixtures', target.id);
  await mkdir(projectRoot, { recursive: true });

  for (const file of ['package.json', 'package-lock.json']) {
    await copyFile(join(fixtureRoot, file), join(projectRoot, file));
  }
  for (const file of applicationFiles) {
    await copyFile(join(exampleRoot, file), join(projectRoot, file));
  }
  await copyFile(join(caseStudyRoot, 'observe.js'), join(projectRoot, 'observe.js'));
  for (const { name } of target.files) {
    await copyFile(join(fixtureRoot, name), join(projectRoot, name));
  }

  return fixtureRoot;
}

async function observeTarget(target, temporaryRoot) {
  const projectRoot = join(temporaryRoot, target.id);
  const fixtureRoot = await assembleTarget(target, projectRoot);
  const manifest = await readJson(join(projectRoot, 'package.json'));

  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], projectRoot);

  const installedDependencies = {};
  for (const [name, expectedVersion] of Object.entries(manifest.dependencies ?? {})) {
    assert.match(expectedVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    const installedManifest = await readJson(
      join(projectRoot, 'node_modules', name, 'package.json'),
    );
    assert.equal(installedManifest.version, expectedVersion);
    installedDependencies[name] = installedManifest.version;
  }

  const result = JSON.parse(await run(process.execPath, ['observe.js'], projectRoot, true));
  const files = await Promise.all([
    describeFile(fixtureRoot, 'package.json', 'dependency manifest'),
    describeFile(fixtureRoot, 'package-lock.json', 'dependency lock'),
    ...target.files.map(({ name, role }) => describeFile(fixtureRoot, name, role)),
  ]);

  return {
    id: target.id,
    label: target.label,
    fixture: `case-studies/chat-room/fixtures/${target.id}`,
    dependencies: installedDependencies,
    files,
    result,
  };
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
assert.ok(
  nodeMajor >= 20,
  `the case study requires Node.js 20 or later, received ${process.version}`,
);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-chat-room-case-study-'));
assert.equal(isInside(repositoryRoot, temporaryRoot), false);

try {
  const observedTargets = [];
  for (const target of selectedTargets) {
    observedTargets.push(await observeTarget(target, temporaryRoot));
  }

  const snapshot = {
    schemaVersion: 1,
    caseStudy: 'moderated-chat-room',
    recordedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      npm: await run('npm', ['--version'], repositoryRoot, true),
    },
    reproduction: {
      run: 'pnpm case-study:chat-room',
      record: 'pnpm case-study:chat-room:record',
      check: 'pnpm case-study:chat-room:check',
      targets: Object.fromEntries(
        targets.map(({ id }) => [id, `node scripts/run-chat-room-case-study.mjs --target ${id}`]),
      ),
    },
    measurements: {
      lineCount: 'physical source lines, including blank and comment lines',
    },
    application: await describeApplication(),
    targets: observedTargets,
    claimBoundary:
      'These observations apply only to the recorded chat-room workflow and are not a claim of overall Socket.IO compatibility.',
  };
  const serialized = await format(JSON.stringify(snapshot), { parser: 'json' });

  if (shouldWrite) {
    await writeFile(observationPath, serialized);
    console.log(`wrote ${relative(repositoryRoot, observationPath)}`);
  } else if (shouldCheck) {
    const recorded = await readJson(observationPath);
    assert.deepEqual(snapshot.application, recorded.application);
    assert.deepEqual(snapshot.targets, recorded.targets);
    console.log('chat-room case study matches the recorded observations');
  } else {
    process.stdout.write(serialized);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
