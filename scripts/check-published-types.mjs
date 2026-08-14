import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readPackedPackage, readTarEntries } from './check-packed-package.mjs';
import { loadReleaseCandidate } from './release-candidate.mjs';
import {
  breakingTypeBumpIsAdequate,
  compareDeclarationEntries,
  parseExactVersion,
  requiredBreakingTypeBump,
  selectPublishedPredecessor,
  versionChangePlan,
} from './published-type-compatibility.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultRegistry = 'https://registry.npmjs.org/';
const packageDefinitions = [
  { name: 'smocket', manifestPath: 'package.json' },
  { name: 'smocket-client', manifestPath: 'packages/smocket-client/package.json' },
];

function run(command, arguments_, { cwd = repositoryRoot, capture = true } = {}) {
  return new Promise((resolveRun, reject) => {
    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArguments = useWindowsCommandShell
      ? ['/d', '/s', '/c', command, ...arguments_]
      : arguments_;
    const child = spawn(executable, executableArguments, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolveRun({ code, signal, stdout, stderr }));
  });
}

function commandFailure(command, result) {
  const detail = sanitizeOutput(result.stderr || result.stdout || `exit ${result.code}`);
  return new Error(
    result.signal
      ? `${command} ended with ${result.signal}: ${detail}`
      : `${command} failed: ${detail}`,
  );
}

function sanitizeOutput(value) {
  return String(value)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[credentials]@')
    .replace(/(_authToken\s*[=:]\s*)\S+/giu, '$1[redacted]')
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/gu, '[redacted npm token]')
    .trim()
    .slice(0, 2000);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function currentManifests() {
  return Object.fromEntries(
    await Promise.all(
      packageDefinitions.map(async ({ name, manifestPath }) => [
        name,
        await readJson(join(repositoryRoot, manifestPath)),
      ]),
    ),
  );
}

export async function baseManifests(baseRevision, execute = run) {
  assert.match(baseRevision, /^[a-f0-9]{7,40}$/iu, '--base must be a Git commit SHA');
  const entries = await Promise.all(
    packageDefinitions.map(async ({ name, manifestPath }) => {
      const result = await execute('git', ['show', `${baseRevision}:${manifestPath}`], {
        cwd: repositoryRoot,
      });
      if (result.code !== 0) throw commandFailure(`git show ${manifestPath}`, result);
      return [name, JSON.parse(result.stdout)];
    }),
  );
  return Object.fromEntries(entries);
}

function validateRegistry(value) {
  const registry = new URL(value ?? defaultRegistry);
  assert.equal(registry.protocol, 'https:', '--registry must use HTTPS');
  assert.equal(registry.username, '', '--registry must not contain credentials');
  assert.equal(registry.password, '', '--registry must not contain credentials');
  assert.equal(registry.search, '', '--registry must not contain query parameters');
  assert.equal(registry.hash, '', '--registry must not contain a fragment');
  return registry.href;
}

export function parsePublishedTypeOptions(arguments_) {
  const [command, ...pairs] = arguments_;
  assert.ok(new Set(['detect', 'check']).has(command), usage());
  assert.equal(pairs.length % 2, 0, usage());
  const options = new Map();
  for (let index = 0; index < pairs.length; index += 2) {
    const flag = pairs[index];
    const value = pairs[index + 1];
    assert.ok(flag?.startsWith('--') && value && !value.startsWith('--'), usage());
    assert.ok(new Set(['--base', '--manifest', '--registry']).has(flag), `Unknown option: ${flag}`);
    assert.ok(!options.has(flag), `Duplicate option: ${flag}`);
    options.set(flag, value);
  }
  const base = options.get('--base') ?? '';
  assert.match(base, /^[a-f0-9]{7,40}$/iu, '--base must be a Git commit SHA');
  const manifest = options.get('--manifest');
  if (command === 'check') assert.ok(manifest, 'check requires --manifest');
  else assert.equal(manifest, undefined, 'detect does not accept --manifest');
  return {
    command,
    base,
    manifest: manifest ? resolve(manifest) : undefined,
    registry: validateRegistry(options.get('--registry')),
  };
}

async function registryVersions(packageName, registry, execute = run) {
  const result = await execute(
    'npm',
    ['view', packageName, 'versions', '--json', '--registry', registry],
    { cwd: repositoryRoot },
  );
  if (result.code !== 0) {
    const response = sanitizeOutput(result.stderr || result.stdout);
    if (/\bE404\b|404 Not Found/iu.test(response)) return [];
    throw commandFailure(`npm view ${packageName} versions`, result);
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : typeof parsed === 'string' ? [parsed] : [];
}

async function downloadPublishedArchive(
  packageName,
  version,
  registry,
  destination,
  execute = run,
) {
  await mkdir(destination, { recursive: true });
  const result = await execute(
    'npm',
    [
      'pack',
      `${packageName}@${version}`,
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      destination,
      '--registry',
      registry,
    ],
    { cwd: repositoryRoot },
  );
  if (result.code !== 0) throw commandFailure(`npm pack ${packageName}@${version}`, result);
  const packed = JSON.parse(result.stdout);
  const filename = packed?.[0]?.filename;
  assert.equal(typeof filename, 'string', `npm pack did not report ${packageName}@${version}`);
  const archivePath = resolve(destination, filename);
  const local = relative(resolve(destination), archivePath);
  assert.ok(local !== '..' && !local.startsWith(`..${sep}`), 'npm pack escaped its destination');
  return archivePath;
}

function safeArchiveRelativePath(entryPath) {
  const normalized = entryPath.replaceAll('\\', '/');
  if (!normalized.startsWith('package/')) return undefined;
  const local = normalized.slice('package/'.length);
  if (!local || local.startsWith('/') || local.split('/').some((part) => part === '..')) {
    throw new Error(`unsafe package archive path: ${entryPath}`);
  }
  return local;
}

async function extractPackageArchive(archivePath, packageRoot) {
  const entries = readTarEntries(await readFile(archivePath));
  let files = 0;
  for (const entry of entries) {
    const local = safeArchiveRelativePath(entry.path);
    if (!local || !['', '\0', '0'].includes(entry.type)) continue;
    const output = resolve(packageRoot, ...local.split('/'));
    const relativeOutput = relative(resolve(packageRoot), output);
    assert.ok(
      relativeOutput !== '..' && !relativeOutput.startsWith(`..${sep}`),
      `archive entry escaped ${packageRoot}`,
    );
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, entry.content, { flag: 'wx' });
    files += 1;
  }
  assert.ok(files > 0, `archive contained no package files: ${archivePath}`);
}

function declarationEntrypoints(manifest) {
  const entries = new Map();
  if (typeof manifest.types === 'string') entries.set('types', manifest.types);
  if (typeof manifest.typings === 'string') entries.set('typings', manifest.typings);

  function visit(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childLabel = `${label}.${key}`;
      if (key === 'types' && typeof child === 'string') entries.set(childLabel, child);
      else visit(child, childLabel);
    }
  }
  visit(manifest.exports?.['.'], 'exports');
  assert.ok(entries.size > 0, `${manifest.name}@${manifest.version} has no declaration entrypoint`);
  return entries;
}

async function compareExtractedPackages(previousPackageRoot, candidatePackageRoot) {
  const [previousManifest, candidateManifest] = await Promise.all(
    [previousPackageRoot, candidatePackageRoot].map((root) => readJson(join(root, 'package.json'))),
  );
  assert.equal(
    previousManifest.name,
    candidateManifest.name,
    'comparison package names must match',
  );
  const previousEntries = declarationEntrypoints(previousManifest);
  const candidateEntries = declarationEntrypoints(candidateManifest);
  const issues = [];
  for (const [label, previousLocal] of previousEntries) {
    const candidateLocal = candidateEntries.get(label);
    if (!candidateLocal) {
      issues.push({ shape: label, reason: 'declaration entrypoint was removed' });
      continue;
    }
    const entryIssues = await compareDeclarationEntries(
      join(previousPackageRoot, previousLocal),
      join(candidatePackageRoot, candidateLocal),
    );
    issues.push(...entryIssues.map((issue) => ({ entrypoint: label, ...issue })));
  }
  return [...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values()];
}

async function packedManifest(archivePath) {
  return readPackedPackage(await readFile(archivePath)).manifest;
}

async function stageComparison({
  workspace,
  packageName,
  previousArchive,
  candidateArchive,
  previousRootPeer,
  candidateRootPeer,
}) {
  const previousPackageRoot = join(workspace, packageName, 'previous', 'node_modules', packageName);
  const candidatePackageRoot = join(
    workspace,
    packageName,
    'candidate',
    'node_modules',
    packageName,
  );
  await extractPackageArchive(previousArchive, previousPackageRoot);
  await extractPackageArchive(candidateArchive, candidatePackageRoot);
  if (packageName === 'smocket-client') {
    assert.ok(previousRootPeer && candidateRootPeer, 'client comparison requires both root peers');
    await extractPackageArchive(
      previousRootPeer,
      join(workspace, packageName, 'previous', 'node_modules', 'smocket'),
    );
    await extractPackageArchive(
      candidateRootPeer,
      join(workspace, packageName, 'candidate', 'node_modules', 'smocket'),
    );
  }
  return compareExtractedPackages(previousPackageRoot, candidatePackageRoot);
}

function issueLine(issue) {
  const change =
    issue.previous === undefined
      ? ''
      : `; previous=${issue.previous}; candidate=${issue.candidate}`;
  return `${issue.entrypoint ?? 'types'}: ${issue.shape}: ${issue.reason}${change}`;
}

export async function executePublishedTypeCheck({
  changes,
  candidate,
  registry,
  execute = run,
  report = console.log,
  listVersions = registryVersions,
  fetchArchive = downloadPublishedArchive,
  readArchiveManifest = packedManifest,
  inspectComparison = stageComparison,
}) {
  if (changes.length === 0) {
    report('published type comparison skipped: no publishable version changed');
    return { checked: [], skipped: packageDefinitions.map(({ name }) => name) };
  }
  assert.equal(
    candidate.version,
    changes[0].candidateVersion,
    'candidate version must match manifests',
  );
  const candidateArchives = {
    smocket: candidate.rootTarball,
    'smocket-client': candidate.clientTarball,
  };
  const workspace = await mkdtemp(join(repositoryRoot, '.published-type-check-'));
  const archiveDirectory = join(workspace, 'archives');
  const downloads = new Map();
  const checked = [];
  const skipped = [];
  const failures = [];

  async function publishedArchive(packageName, version) {
    const key = `${packageName}@${version}`;
    if (!downloads.has(key)) {
      downloads.set(key, fetchArchive(packageName, version, registry, archiveDirectory, execute));
    }
    return downloads.get(key);
  }

  try {
    for (const change of changes) {
      const versions = await listVersions(change.packageName, registry, execute);
      const previousVersion = selectPublishedPredecessor(versions, change.candidateVersion);
      if (!previousVersion) {
        report(
          `${change.packageName}@${change.candidateVersion}: no published predecessor; comparison skipped`,
        );
        skipped.push(change.packageName);
        continue;
      }

      const previousArchive = await publishedArchive(change.packageName, previousVersion);
      let previousRootPeer;
      if (change.packageName === 'smocket-client') {
        const previousClientManifest = await readArchiveManifest(previousArchive);
        const peerVersion = previousClientManifest.peerDependencies?.smocket;
        parseExactVersion(peerVersion ?? '');
        previousRootPeer = await publishedArchive('smocket', peerVersion);
      }
      const issues = await inspectComparison({
        workspace,
        packageName: change.packageName,
        previousArchive,
        candidateArchive: candidateArchives[change.packageName],
        previousRootPeer,
        candidateRootPeer: candidate.rootTarball,
      });
      checked.push(change.packageName);

      if (issues.length === 0) {
        report(
          `${change.packageName}: ${previousVersion} -> ${change.candidateVersion}; existing public type call sites remain compatible`,
        );
        continue;
      }

      const required = requiredBreakingTypeBump(previousVersion);
      const detail = issues.map((issue) => `  - ${issueLine(issue)}`).join('\n');
      if (!breakingTypeBumpIsAdequate(previousVersion, change.candidateVersion)) {
        failures.push(
          `${change.packageName}: ${previousVersion} -> ${change.candidateVersion} requires at least a ${required} bump for incompatible public types:\n${detail}`,
        );
      } else {
        report(
          `${change.packageName}: ${previousVersion} -> ${change.candidateVersion}; incompatible public types are covered by the ${required} bump:\n${detail}`,
        );
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  if (failures.length > 0) throw new Error(failures.join('\n\n'));
  return { checked, skipped };
}

async function detect(options) {
  const [base, current] = await Promise.all([baseManifests(options.base), currentManifests()]);
  const changes = versionChangePlan(base, current);
  console.error(
    changes.length === 0
      ? 'No publishable package version changed.'
      : `Publishable version change: ${changes
          .map(
            ({ packageName, baseVersion, candidateVersion }) =>
              `${packageName} ${baseVersion} -> ${candidateVersion}`,
          )
          .join(', ')}`,
  );
  console.log(`changed=${changes.length > 0}`);
}

async function check(options) {
  const [base, current, candidate] = await Promise.all([
    baseManifests(options.base),
    currentManifests(),
    loadReleaseCandidate(options.manifest),
  ]);
  const changes = versionChangePlan(base, current);
  await executePublishedTypeCheck({ changes, candidate, registry: options.registry });
}

function usage() {
  return 'Usage: node scripts/check-published-types.mjs <detect|check> --base <commit-sha> [--manifest <release-candidate.json>] [--registry <https-url>]';
}

async function main() {
  const options = parsePublishedTypeOptions(process.argv.slice(2));
  if (options.command === 'detect') await detect(options);
  else await check(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
