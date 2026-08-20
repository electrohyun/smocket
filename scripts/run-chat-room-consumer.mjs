import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertCandidatePackageIdentities } from './chat-room-consumer-validation.mjs';

const modes = new Set(['candidate', 'published']);
const mode = process.argv[2];
const tarballIndex = process.argv.indexOf('--tarball');
const suppliedTarball = tarballIndex === -1 ? undefined : process.argv[tarballIndex + 1];
const clientTarballIndex = process.argv.indexOf('--client-tarball');
const suppliedClientTarball =
  clientTarballIndex === -1 ? undefined : process.argv[clientTarballIndex + 1];
const versionIndex = process.argv.indexOf('--version');
const suppliedVersion = versionIndex === -1 ? undefined : process.argv[versionIndex + 1];

if (!modes.has(mode)) {
  throw new Error(
    'Usage: node scripts/run-chat-room-consumer.mjs <candidate|published> [--tarball <absolute-path> --client-tarball <absolute-path>] [--version <exact-version>]',
  );
}
if (tarballIndex !== -1 && (suppliedTarball === undefined || suppliedTarball.startsWith('--'))) {
  throw new Error('--tarball requires a path');
}
if (
  clientTarballIndex !== -1 &&
  (suppliedClientTarball === undefined || suppliedClientTarball.startsWith('--'))
) {
  throw new Error('--client-tarball requires a path');
}
if (versionIndex !== -1 && (suppliedVersion === undefined || suppliedVersion.startsWith('--'))) {
  throw new Error('--version requires an exact version');
}
if (mode === 'candidate' && suppliedVersion !== undefined) {
  throw new Error('candidate mode accepts tarballs instead of --version');
}
if (
  mode === 'published' &&
  (suppliedTarball !== undefined || suppliedClientTarball !== undefined)
) {
  throw new Error('published mode accepts --version instead of tarballs');
}
if ((suppliedTarball === undefined) !== (suppliedClientTarball === undefined)) {
  throw new Error('--tarball and --client-tarball must be supplied together');
}

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const consumerRoot = join(repositoryRoot, 'consumers', 'chat-room');
const exampleRoot = join(repositoryRoot, 'examples', 'chat-room');
const clientPackageRoot = join(repositoryRoot, 'packages', 'smocket-client');
const applicationFiles = [
  'app.js',
  'assertions.js',
  'bootstrap.js',
  'dual-target.test.js',
  'index.js',
  'scenario.js',
  'targets.js',
];

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env, npm_config_update_notifier: 'false' };
    delete environment.npm_config_manage_package_manager_versions;
    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;

    const child = spawn(executable, executableArgs, {
      cwd,
      env: environment,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal ? `${command} was terminated by ${signal}` : `${command} exited with code ${code}`,
        ),
      );
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

function asFileDependency(pathFromProject) {
  return `file:${pathFromProject.split(sep).join('/')}`;
}

async function assembleProject(projectRoot, includeLockfile) {
  await mkdir(projectRoot, { recursive: true });
  await copyFile(join(consumerRoot, 'package.json'), join(projectRoot, 'package.json'));

  if (includeLockfile) {
    await copyFile(join(consumerRoot, 'package-lock.json'), join(projectRoot, 'package-lock.json'));
  }

  await Promise.all(
    applicationFiles.map((file) => copyFile(join(exampleRoot, file), join(projectRoot, file))),
  );
}

async function installPublished(projectRoot) {
  const manifest = await readJson(join(projectRoot, 'package.json'));
  const expectedVersion = manifest.dependencies.smocket;
  const expectedClientVersion = manifest.dependencies['smocket-client'];

  assert.match(
    expectedVersion,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    'the published consumer must pin an exact Smocket version',
  );
  assert.equal(
    expectedClientVersion,
    expectedVersion,
    'the published consumer must pin both Smocket packages at one version',
  );
  if (suppliedVersion !== undefined) {
    assert.equal(
      expectedVersion,
      suppliedVersion,
      'the published consumer pin must match the supplied supported version',
    );
  }

  await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], projectRoot);

  const lockfile = await readJson(join(projectRoot, 'package-lock.json'));
  const lockedPackage = lockfile.packages['node_modules/smocket'];
  const lockedClientPackage = lockfile.packages['node_modules/smocket-client'];
  const installedPackage = await readJson(
    join(projectRoot, 'node_modules', 'smocket', 'package.json'),
  );
  const installedClientPackage = await readJson(
    join(projectRoot, 'node_modules', 'smocket-client', 'package.json'),
  );

  assert.equal(lockfile.packages[''].dependencies.smocket, expectedVersion);
  assert.equal(lockfile.packages[''].dependencies['smocket-client'], expectedClientVersion);
  assert.equal(lockedPackage.version, expectedVersion);
  assert.equal(lockedClientPackage.version, expectedClientVersion);
  assert.match(lockedPackage.resolved, /^https:\/\/registry\.npmjs\.org\/smocket\//);
  assert.match(lockedClientPackage.resolved, /^https:\/\/registry\.npmjs\.org\/smocket-client\//);
  assert.equal(installedPackage.version, expectedVersion);
  assert.equal(installedClientPackage.version, expectedClientVersion);
}

async function packCandidate(packageRoot, archiveRoot) {
  await mkdir(archiveRoot, { recursive: true });
  const existingArchives = new Set(await readdir(archiveRoot));
  await run(
    'npm',
    ['pack', '.', '--ignore-scripts', '--pack-destination', archiveRoot],
    packageRoot,
  );
  const archives = (await readdir(archiveRoot)).filter(
    (file) => file.endsWith('.tgz') && !existingArchives.has(file),
  );
  assert.equal(archives.length, 1, `npm pack must produce one tarball for ${packageRoot}`);
  return join(archiveRoot, archives[0]);
}

async function installCandidate(projectRoot, temporaryRoot) {
  const rootManifest = await readJson(join(repositoryRoot, 'package.json'));
  let archivePath;
  let clientArchivePath;
  if (suppliedTarball === undefined) {
    const archiveRoot = join(temporaryRoot, 'package');
    await access(join(repositoryRoot, 'dist', 'index.js'));
    await access(join(clientPackageRoot, 'dist', 'index.mjs'));
    archivePath = await packCandidate(repositoryRoot, archiveRoot);
    clientArchivePath = await packCandidate(clientPackageRoot, archiveRoot);
  } else {
    assert.equal(isAbsolute(suppliedTarball), true, 'candidate --tarball must be an absolute path');
    assert.equal(
      isAbsolute(suppliedClientTarball),
      true,
      'candidate --client-tarball must be an absolute path',
    );
    await access(suppliedTarball);
    await access(suppliedClientTarball);
    archivePath = suppliedTarball;
    clientArchivePath = suppliedClientTarball;
  }
  const manifestPath = join(projectRoot, 'package.json');
  const manifest = await readJson(manifestPath);
  const packageInput = asFileDependency(relative(projectRoot, archivePath));
  const clientPackageInput = asFileDependency(relative(projectRoot, clientArchivePath));

  manifest.dependencies.smocket = packageInput;
  manifest.dependencies['smocket-client'] = clientPackageInput;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], projectRoot);

  const lockfile = await readJson(join(projectRoot, 'package-lock.json'));
  const lockedPackage = lockfile.packages['node_modules/smocket'];
  const lockedClientPackage = lockfile.packages['node_modules/smocket-client'];
  const installedPackage = await readJson(
    join(projectRoot, 'node_modules', 'smocket', 'package.json'),
  );
  const installedClientPackage = await readJson(
    join(projectRoot, 'node_modules', 'smocket-client', 'package.json'),
  );

  assert.equal(lockfile.packages[''].dependencies.smocket, packageInput);
  assert.equal(lockfile.packages[''].dependencies['smocket-client'], clientPackageInput);
  assert.equal(lockedPackage.resolved, packageInput);
  assert.equal(lockedClientPackage.resolved, clientPackageInput);
  assertCandidatePackageIdentities(installedPackage, installedClientPackage, rootManifest.version);
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
assert.ok(
  nodeMajor >= 20,
  `the consumer requires Node.js 20 or later, received ${process.version}`,
);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-chat-room-consumer-'));
const projectRoot = join(temporaryRoot, 'project');
process.env.npm_config_cache = join(temporaryRoot, 'npm-cache');

try {
  assert.equal(
    isInside(repositoryRoot, temporaryRoot),
    false,
    'the independent consumer must run outside the repository checkout',
  );
  await assembleProject(projectRoot, mode === 'published');

  if (mode === 'published') {
    await installPublished(projectRoot);
  } else {
    await installCandidate(projectRoot, temporaryRoot);
  }

  await run('npm', ['test'], projectRoot);
  await run('npm', ['start'], projectRoot);
  console.log(`${mode} chat-room consumer passed`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
