import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readPackedPackage } from './check-packed-package.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageDefinitions = [
  { name: 'smocket', root: repositoryRoot },
  { name: 'smocket-client', root: join(repositoryRoot, 'packages', 'smocket-client') },
];

function run(command, args, cwd, environmentOverrides = {}, stdio = 'inherit') {
  return new Promise((resolveRun, reject) => {
    const useWindowsCommandShell =
      process.platform === 'win32' && (command === 'npm' || command === 'pnpm');
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false', ...environmentOverrides },
      stdio,
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolveRun();
      else {
        reject(
          new Error(signal ? `${command} ended with ${signal}` : `${command} exited with ${code}`),
        );
      }
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function packedManifest(archive) {
  return readPackedPackage(archive).manifest;
}

function validateManifestShape(manifest) {
  if (manifest?.schemaVersion !== 1 || typeof manifest.version !== 'string') {
    throw new Error('Release candidate manifest must use schemaVersion 1 and one version');
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length !== packageDefinitions.length) {
    throw new Error('Release candidate manifest must contain smocket and smocket-client');
  }

  for (const [index, definition] of packageDefinitions.entries()) {
    const entry = manifest.packages[index];
    if (
      entry?.name !== definition.name ||
      entry.version !== manifest.version ||
      typeof entry.filename !== 'string' ||
      basename(entry.filename) !== entry.filename ||
      typeof entry.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size <= 0
    ) {
      throw new Error(`Invalid ${definition.name} release candidate entry`);
    }
  }
}

export async function loadReleaseCandidate(manifestPath) {
  const resolvedManifest = resolve(manifestPath);
  const manifest = await readJson(resolvedManifest);
  validateManifestShape(manifest);
  const manifestRoot = dirname(resolvedManifest);
  const artifacts = {};

  for (const entry of manifest.packages) {
    const archivePath = join(manifestRoot, entry.filename);
    const archive = await readFile(archivePath);
    const archiveStat = await stat(archivePath);
    if (archiveStat.size !== entry.size) {
      throw new Error(`${entry.name} candidate size changed after manifest creation`);
    }
    if (digest(archive) !== entry.sha256) {
      throw new Error(`${entry.name} candidate digest changed after manifest creation`);
    }

    const packageManifest = packedManifest(archive);
    if (packageManifest.name !== entry.name || packageManifest.version !== manifest.version) {
      throw new Error(`${entry.name} candidate identity does not match the release manifest`);
    }
    if (
      entry.name === 'smocket-client' &&
      packageManifest.peerDependencies?.smocket !== manifest.version
    ) {
      throw new Error(`smocket-client candidate must have exact smocket peer ${manifest.version}`);
    }
    artifacts[entry.name] = archivePath;
  }

  return {
    manifestPath: resolvedManifest,
    version: manifest.version,
    rootTarball: artifacts.smocket,
    clientTarball: artifacts['smocket-client'],
  };
}

async function assertEmptyOutput(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const entries = await readdir(outputDirectory);
  if (entries.length !== 0) {
    throw new Error(`Release candidate output must be empty: ${outputDirectory}`);
  }
}

export async function createReleaseCandidate(outputDirectory) {
  const resolvedOutput = resolve(outputDirectory);
  await assertEmptyOutput(resolvedOutput);

  const sourceManifests = await Promise.all(
    packageDefinitions.map(({ root }) => readJson(join(root, 'package.json'))),
  );
  const version = sourceManifests[0].version;
  if (
    sourceManifests[1].version !== version ||
    sourceManifests[1].peerDependencies?.smocket !== version
  ) {
    throw new Error('smocket and smocket-client must use one version and an exact peer');
  }

  await run('pnpm', ['build'], repositoryRoot);
  await run('pnpm', ['--filter', 'smocket-client', 'build'], repositoryRoot);

  const cache = join(resolvedOutput, '.npm-cache');
  for (const definition of packageDefinitions) {
    await run(
      'npm',
      ['pack', '.', '--ignore-scripts', '--pack-destination', resolvedOutput],
      definition.root,
      { npm_config_cache: cache },
      'ignore',
    );
  }
  await rm(cache, { recursive: true, force: true });

  const archives = (await readdir(resolvedOutput)).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== packageDefinitions.length) {
    throw new Error(`Expected two release tarballs, found ${archives.join(', ')}`);
  }
  const packages = [];
  for (const [index, definition] of packageDefinitions.entries()) {
    const expectedFilename = `${definition.name}-${version}.tgz`;
    if (!archives.includes(expectedFilename)) {
      throw new Error(`Expected ${expectedFilename}, found ${archives.join(', ')}`);
    }
    const archive = await readFile(join(resolvedOutput, expectedFilename));
    const manifest = packedManifest(archive);
    if (manifest.name !== definition.name || manifest.version !== version) {
      throw new Error(`${definition.name} packed identity differs from its source manifest`);
    }
    if (index === 1 && manifest.peerDependencies?.smocket !== version) {
      throw new Error(`smocket-client candidate must have exact smocket peer ${version}`);
    }
    packages.push({
      name: definition.name,
      version,
      filename: expectedFilename,
      sha256: digest(archive),
      size: archive.length,
    });
  }
  const manifestPath = join(resolvedOutput, 'release-candidate.json');
  await writeFile(
    manifestPath,
    `${JSON.stringify({ schemaVersion: 1, version, packages }, null, 2)}\n`,
    { flag: 'wx' },
  );
  await loadReleaseCandidate(manifestPath);
  return manifestPath;
}

function readOption(flag) {
  const index = process.argv.indexOf(flag);
  const value = process.argv[index + 1];
  if (index === -1 || value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a path`);
  }
  return isAbsolute(value) ? value : resolve(value);
}

async function main() {
  const command = process.argv[2];
  if (command === 'create') {
    const manifestPath = await createReleaseCandidate(readOption('--output'));
    console.log(`Release candidate created: ${manifestPath}`);
    return;
  }
  if (command === 'verify') {
    const candidate = await loadReleaseCandidate(readOption('--manifest'));
    console.log(`Release candidate verified: ${candidate.version} (${candidate.manifestPath})`);
    return;
  }
  throw new Error(
    'Usage: node scripts/release-candidate.mjs <create --output DIR|verify --manifest FILE>',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
