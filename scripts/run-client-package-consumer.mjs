import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadReleaseCandidate } from './release-candidate.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const clientRoot = join(repositoryRoot, 'packages', 'smocket-client');
const version = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).version;
const browser = process.argv.slice(2).includes('--browser');
const manifestIndex = process.argv.indexOf('--manifest');
const candidateManifest = manifestIndex === -1 ? undefined : process.argv[manifestIndex + 1];

if (
  manifestIndex !== -1 &&
  (candidateManifest === undefined || candidateManifest.startsWith('--'))
) {
  throw new Error('--manifest requires a path');
}

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

async function pack(packageRoot, destination, cache) {
  await run(
    'npm',
    ['pack', '.', '--ignore-scripts', '--pack-destination', destination],
    packageRoot,
    { npm_config_cache: cache },
    'ignore',
  );
}

async function runManifestCandidate(manifestPath) {
  const candidate = await loadReleaseCandidate(manifestPath);
  const args = [
    join(repositoryRoot, 'scripts', 'run-clean-adoption.mjs'),
    'candidate',
    '--version',
    candidate.version,
    '--tarball',
    candidate.rootTarball,
    '--client-tarball',
    candidate.clientTarball,
  ];
  if (browser) args.push('--browser');
  await run(process.execPath, args, repositoryRoot);
  await loadReleaseCandidate(manifestPath);
}

if (candidateManifest !== undefined) {
  await runManifestCandidate(candidateManifest);
} else {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-client-consumer-'));
  const cache = join(temporaryRoot, 'npm-cache');

  try {
    await run('pnpm', ['build'], repositoryRoot);
    await run('pnpm', ['--filter', 'smocket-client', 'build'], repositoryRoot);
    await pack(repositoryRoot, temporaryRoot, cache);
    await pack(clientRoot, temporaryRoot, cache);
    const archives = (await readdir(temporaryRoot)).filter((file) => file.endsWith('.tgz'));
    const rootArchive = archives.find((file) => file === `smocket-${version}.tgz`);
    const clientArchive = archives.find((file) => file === `smocket-client-${version}.tgz`);
    if (rootArchive === undefined || clientArchive === undefined || archives.length !== 2) {
      throw new Error(
        `Expected synchronized root and client tarballs, found ${archives.join(', ')}`,
      );
    }

    const args = [
      join(repositoryRoot, 'scripts', 'run-clean-adoption.mjs'),
      'candidate',
      '--version',
      version,
      '--tarball',
      resolve(temporaryRoot, rootArchive),
      '--client-tarball',
      resolve(temporaryRoot, clientArchive),
    ];
    if (browser) args.push('--browser');
    await run(process.execPath, args, repositoryRoot, { npm_config_cache: cache });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
