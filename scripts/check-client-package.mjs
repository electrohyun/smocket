import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPackedPackage } from './check-packed-package.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const clientRoot = join(repositoryRoot, 'packages', 'smocket-client');

function run(command, args, cwd, environmentOverrides = {}) {
  return new Promise((resolve, reject) => {
    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false', ...environmentOverrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}${stderr ? `:\n${stderr}` : ''}`));
    });
  });
}

function isEmptyOrAbsent(manifest, field) {
  if (!Object.hasOwn(manifest, field)) return true;
  const value = manifest[field];
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function isBundleFieldEmpty(manifest, field) {
  if (!Object.hasOwn(manifest, field)) return true;
  const value = manifest[field];
  return value === false || (Array.isArray(value) && value.length === 0);
}

export function inspectClientPackagePolicy({
  rootManifest,
  sourceManifest,
  packedManifest,
  tarEntries,
}) {
  const violations = [];
  const manifests = [
    ['source manifest', sourceManifest],
    ['packed manifest', packedManifest],
  ];

  for (const [location, manifest] of manifests) {
    if (manifest.name !== 'smocket-client') {
      violations.push(`${location} must be named smocket-client`);
    }
    if (manifest.version !== rootManifest.version) {
      violations.push(`${location} version must equal smocket ${rootManifest.version}`);
    }
    const peers = manifest.peerDependencies;
    if (
      typeof peers !== 'object' ||
      peers === null ||
      Array.isArray(peers) ||
      Object.keys(peers).length !== 1 ||
      peers.smocket !== rootManifest.version
    ) {
      violations.push(`${location} must have only the exact smocket ${rootManifest.version} peer`);
    }
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependenciesMeta']) {
      if (!isEmptyOrAbsent(manifest, field)) {
        violations.push(`${location} ${field} must be absent or empty`);
      }
    }
    for (const field of ['bundleDependencies', 'bundledDependencies']) {
      if (!isBundleFieldEmpty(manifest, field)) {
        violations.push(`${location} ${field} must be absent, false, or empty`);
      }
    }
  }

  const bundledEntries = tarEntries.filter((entry) =>
    entry.split('/').some((part) => part.toLowerCase() === 'node_modules'),
  );
  for (const entry of bundledEntries) {
    violations.push(`packed tarball must not contain ${entry}`);
  }

  return { passed: violations.length === 0, violations };
}

async function main() {
  const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
  const sourceManifest = JSON.parse(await readFile(join(clientRoot, 'package.json'), 'utf8'));
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-client-policy-'));

  try {
    const tarballIndex = process.argv.indexOf('--tarball');
    const suppliedTarball = tarballIndex === -1 ? undefined : process.argv[tarballIndex + 1];
    if (
      tarballIndex !== -1 &&
      (suppliedTarball === undefined || suppliedTarball.startsWith('--'))
    ) {
      throw new Error('--tarball requires a path');
    }

    let archivePath;
    if (suppliedTarball === undefined) {
      const { stdout } = await run(
        'npm',
        ['pack', '.', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
        clientRoot,
        { npm_config_cache: join(temporaryRoot, 'npm-cache') },
      );
      const packResult = JSON.parse(stdout);
      if (!Array.isArray(packResult) || packResult.length !== 1) {
        throw new Error('npm pack must produce exactly one client tarball');
      }
      const archives = (await readdir(temporaryRoot)).filter((file) => file.endsWith('.tgz'));
      if (archives.length !== 1 || archives[0] !== basename(packResult[0].filename)) {
        throw new Error('npm pack must produce exactly the reported client tarball');
      }
      archivePath = join(temporaryRoot, archives[0]);
    } else {
      archivePath = resolve(suppliedTarball);
    }
    const { entries, manifest: packedManifest } = readPackedPackage(await readFile(archivePath));
    const result = inspectClientPackagePolicy({
      rootManifest,
      sourceManifest,
      packedManifest,
      tarEntries: entries.map((entry) => entry.path),
    });

    if (!result.passed) {
      throw new Error(
        `Client package policy failed:\n${result.violations.map((item) => `  ${item}`).join('\n')}`,
      );
    }
    console.log(
      `Client package policy passed for synchronized version ${rootManifest.version}, exact peer, and ${entries.length} tar entries.`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
