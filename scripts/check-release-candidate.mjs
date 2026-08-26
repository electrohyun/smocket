import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadReleaseCandidate } from './release-candidate.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const publintCli = join(dirname(require.resolve('publint')), 'cli.js');
const attwCli = join(
  dirname(require.resolve('@arethetypeswrong/cli/package.json')),
  'dist',
  'index.js',
);

function run(command, args, cwd = repositoryRoot) {
  return new Promise((resolveRun, reject) => {
    const useWindowsCommandShell =
      process.platform === 'win32' && (command === 'npm' || command === 'pnpm');
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      stdio: 'inherit',
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

function readManifestOption() {
  const index = process.argv.indexOf('--manifest');
  const value = process.argv[index + 1];
  if (index === -1 || value === undefined || value.startsWith('--')) {
    throw new Error('--manifest requires a path');
  }
  return resolve(value);
}

async function verifiedCandidate(manifestPath) {
  return loadReleaseCandidate(manifestPath);
}

const manifestPath = readManifestOption();
let candidate = await verifiedCandidate(manifestPath);

await run(process.execPath, [
  join(repositoryRoot, 'scripts', 'check-packed-package.mjs'),
  '--tarball',
  candidate.rootTarball,
]);
candidate = await verifiedCandidate(manifestPath);
await run(process.execPath, [
  join(repositoryRoot, 'scripts', 'check-self-contained-types.mjs'),
  '--tarball',
  candidate.rootTarball,
  '--client-tarball',
  candidate.clientTarball,
  '--minimum',
]);
candidate = await verifiedCandidate(manifestPath);
await run(process.execPath, [
  join(repositoryRoot, 'scripts', 'check-self-contained-types.mjs'),
  '--tarball',
  candidate.rootTarball,
  '--client-tarball',
  candidate.clientTarball,
]);
candidate = await verifiedCandidate(manifestPath);
await run(process.execPath, [
  join(repositoryRoot, 'scripts', 'check-client-package.mjs'),
  '--tarball',
  candidate.clientTarball,
]);

for (const packageName of ['smocket', 'smocket-client']) {
  candidate = await verifiedCandidate(manifestPath);
  const currentTarball =
    packageName === 'smocket' ? candidate.rootTarball : candidate.clientTarball;
  await run(process.execPath, [publintCli, currentTarball]);
  candidate = await verifiedCandidate(manifestPath);
  await run(process.execPath, [
    attwCli,
    packageName === 'smocket' ? candidate.rootTarball : candidate.clientTarball,
  ]);
}

candidate = await verifiedCandidate(manifestPath);
await run(process.execPath, [
  join(repositoryRoot, 'scripts', 'run-chat-room-consumer.mjs'),
  'candidate',
  '--tarball',
  candidate.rootTarball,
  '--client-tarball',
  candidate.clientTarball,
]);

candidate = await verifiedCandidate(manifestPath);
await run(process.execPath, [
  join(repositoryRoot, 'scripts', 'run-clean-adoption.mjs'),
  'candidate',
  '--version',
  candidate.version,
  '--tarball',
  candidate.rootTarball,
  '--client-tarball',
  candidate.clientTarball,
]);

candidate = await verifiedCandidate(manifestPath);
console.log(`All package checks consumed release candidate ${candidate.version}: ${manifestPath}`);
