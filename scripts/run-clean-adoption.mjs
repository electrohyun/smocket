import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(repositoryRoot, 'consumers', 'test-adoption');
const exampleRoot = join(repositoryRoot, 'examples', 'chat-room');
const fixtureToolVersions = {
  '@vitest/browser': '4.1.10',
  '@vitest/browser-playwright': '4.1.10',
  jest: '30.2.0',
  playwright: '1.62.1',
  'socket.io-client': '4.8.3',
  typescript: '6.0.3',
  vitest: '4.1.10',
};
const applicationFiles = ['app.js', 'assertions.js', 'scenario.js'];
const [mode, ...arguments_] = process.argv.slice(2);
const options = new Map();

for (let index = 0; index < arguments_.length; index += 2) {
  const flag = arguments_[index];
  const value = arguments_[index + 1];

  if (flag === '--browser') {
    options.set(flag, true);
    index -= 1;
    continue;
  }

  if (!flag?.startsWith('--') || value === undefined) {
    throw new Error(
      'Usage: node scripts/run-clean-adoption.mjs <candidate|published> --version <exact-version> [--tarball <absolute-path>] [--browser]',
    );
  }

  options.set(flag, value);
}

if (!new Set(['candidate', 'published']).has(mode)) {
  throw new Error('The first argument must be candidate or published');
}

const version = options.get('--version');
assert.match(
  version ?? '',
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
  'the package version must be exact',
);

const archivePath = options.get('--tarball');
if (mode === 'candidate') {
  assert.equal(typeof archivePath, 'string', 'candidate mode requires --tarball');
  assert.equal(isAbsolute(archivePath), true, 'candidate --tarball must be an absolute path');
  await access(archivePath);
} else {
  assert.equal(archivePath, undefined, 'published mode installs from the exact registry version');
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === '' || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..')
  );
}

function run(command, args, cwd, label) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(new Error(`${label}: ${signal ? `terminated by ${signal}` : `exited with ${code}`}`));
    });
  });
}

function runExpectingFailure(command, args, cwd, label) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code !== 0) {
        resolveRun();
        return;
      }

      reject(new Error(`${label}: unexpectedly succeeded${signal ? ` (${signal})` : ''}`));
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function assembleProject(projectRoot) {
  await cp(fixtureRoot, projectRoot, { recursive: true });
  await Promise.all(
    applicationFiles.map((file) => cp(join(exampleRoot, file), join(projectRoot, 'shared', file))),
  );

  const packageInput = mode === 'candidate' ? `file:${archivePath.split(sep).join('/')}` : version;
  const manifest = {
    name: 'smocket-clean-adoption',
    private: true,
    type: 'module',
    engines: { node: '>=20' },
    dependencies: { smocket: packageInput },
    devDependencies: fixtureToolVersions,
  };

  await writeFile(join(projectRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return packageInput;
}

async function assertInstalledIdentity(projectRoot, packageInput) {
  const packagePath = join(projectRoot, 'node_modules', 'smocket', 'package.json');
  const installed = await readJson(packagePath);
  const resolvedPath = createRequire(join(projectRoot, 'package.json')).resolve('smocket');

  assert.equal(
    installed.version,
    version,
    'installed smocket version differs from the requested version',
  );
  assert.equal(
    isInside(repositoryRoot, resolvedPath),
    false,
    'smocket must resolve from the clean consumer, not the checkout',
  );
  console.log(`clean adoption package input: ${packageInput}`);
  console.log(`clean adoption source version: ${version}`);
  console.log(`clean adoption installed version: ${installed.version}`);
  console.log(`clean adoption resolved identity: ${resolvedPath}`);
}

async function runNodeFixtures(projectRoot) {
  const vitest = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const jest = join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  await run(
    process.execPath,
    [vitest, 'run', '--config', 'vitest-suite/vitest.config.js'],
    projectRoot,
    'vitest-suite',
  );
  await run(
    process.execPath,
    [vitest, 'run', '--config', 'vitest-file/vitest.config.js'],
    projectRoot,
    'vitest-file',
  );
  await run(
    process.execPath,
    [jest, '--config', 'jest/jest.config.cjs', '--runInBand'],
    projectRoot,
    'jest',
  );
  await run(process.execPath, [tsc, '-p', 'types/esm'], projectRoot, 'types/esm');
  await run(process.execPath, ['types/esm/dist/valid.js'], projectRoot, 'types/esm runtime');
  await run(process.execPath, [tsc, '-p', 'types/cjs'], projectRoot, 'types/cjs');
  await runExpectingFailure(
    process.execPath,
    [tsc, '-p', 'types/invalid'],
    projectRoot,
    'types/invalid',
  );
  await run(
    process.execPath,
    [
      vitest,
      'run',
      'static-namespace/adoption.test.js',
      '--config',
      'static-namespace/vitest.config.js',
    ],
    projectRoot,
    'static-namespace',
  );
}

async function runPublishedFixtures(projectRoot) {
  const vitest = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const jest = join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  await run(
    process.execPath,
    [vitest, 'run', '--config', 'vitest-suite/vitest.config.js'],
    projectRoot,
    'published vitest-suite',
  );
  await run(
    process.execPath,
    [jest, '--config', 'jest/jest.config.cjs', '--runInBand'],
    projectRoot,
    'published jest',
  );
  await run(process.execPath, [tsc, '-p', 'types/esm'], projectRoot, 'published types/esm');
  await run(process.execPath, [tsc, '-p', 'types/cjs'], projectRoot, 'published types/cjs');
  await runExpectingFailure(
    process.execPath,
    [tsc, '-p', 'types/invalid'],
    projectRoot,
    'published types/invalid',
  );
}

async function runBrowserFixture(projectRoot) {
  const vitest = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  await run(
    process.execPath,
    [vitest, 'run', 'browser/adoption.test.js', '--config', 'browser/vitest.config.js'],
    projectRoot,
    'browser',
  );
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-clean-adoption-'));
const projectRoot = join(temporaryRoot, 'project');
process.env.npm_config_cache = join(temporaryRoot, 'npm-cache');

try {
  assert.equal(
    isInside(repositoryRoot, temporaryRoot),
    false,
    'the clean adoption project must run outside the repository checkout',
  );
  const packageInput = await assembleProject(projectRoot);
  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    projectRoot,
    'install',
  );
  await assertInstalledIdentity(projectRoot, packageInput);

  if (mode === 'candidate') {
    await runNodeFixtures(projectRoot);
    if (options.get('--browser') === true) await runBrowserFixture(projectRoot);
  } else {
    await runPublishedFixtures(projectRoot);
  }

  console.log(`${mode} clean adoption fixtures passed`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
