import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadReleaseCandidate } from './release-candidate.mjs';
import { sanitizeRegistryResponse } from './verify-published-release.mjs';

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const packageNames = new Set(['smocket', 'smocket-client']);
const defaultRegistry = 'https://registry.npmjs.org/';

export function parsePublicationOptions(arguments_) {
  const [command, ...pairs] = arguments_;
  if (!new Set(['verify', 'publish']).has(command)) throw new Error(usage());
  if (pairs.length % 2 !== 0) throw new Error(usage());

  const options = new Map();
  for (let index = 0; index < pairs.length; index += 2) {
    const flag = pairs[index];
    const value = pairs[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(usage());
    }
    if (!new Set(['--manifest', '--version', '--package', '--registry']).has(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (options.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    options.set(flag, value);
  }

  const manifest = options.get('--manifest');
  if (!manifest) throw new Error('--manifest requires a path');
  const version = options.get('--version') ?? '';
  assert.match(version, exactVersionPattern, '--version must be an exact npm version');

  const packageName = options.get('--package');
  if (command === 'publish') {
    assert.ok(
      packageName && packageNames.has(packageName),
      '--package must name a released package',
    );
  } else if (packageName !== undefined) {
    throw new Error('verify does not accept --package');
  }

  const registry = new URL(options.get('--registry') ?? defaultRegistry);
  assert.equal(registry.protocol, 'https:', '--registry must use HTTPS');
  assert.equal(registry.username, '', '--registry must not contain credentials');
  assert.equal(registry.password, '', '--registry must not contain credentials');
  assert.equal(registry.search, '', '--registry must not contain query parameters');
  assert.equal(registry.hash, '', '--registry must not contain a fragment');

  return {
    command,
    manifest: resolve(manifest),
    version,
    packageName,
    registry: registry.href,
  };
}

export function publicationPlan(candidate, packageName, registry) {
  assert.ok(packageNames.has(packageName), 'unknown release package');
  const tarball = packageName === 'smocket' ? candidate.rootTarball : candidate.clientTarball;
  return {
    command: 'npm',
    arguments: ['publish', tarball, '--ignore-scripts', '--registry', registry],
  };
}

export function rootVersionLookupPlan(version, registry) {
  return {
    command: 'npm',
    arguments: ['view', `smocket@${version}`, 'version', '--json', '--registry', registry],
  };
}

export function assertExactRootVersion(response, expected) {
  let published;
  try {
    published = JSON.parse(response);
  } catch (error) {
    throw new Error(
      `Registry returned invalid JSON for smocket@${expected}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assert.equal(published, expected, `Registry must contain exact smocket@${expected}`);
}

export async function executePublication(
  options,
  { loadCandidate = loadReleaseCandidate, run = runCommand } = {},
) {
  const candidate = await loadCandidate(options.manifest);
  assert.equal(candidate.version, options.version, 'requested version must match the candidate');

  if (options.command === 'verify') {
    return { version: candidate.version, published: undefined };
  }

  if (options.packageName === 'smocket-client') {
    const lookup = rootVersionLookupPlan(candidate.version, options.registry);
    const response = await run(lookup.command, lookup.arguments, { capture: true });
    assertExactRootVersion(response, candidate.version);
  }

  const plan = publicationPlan(candidate, options.packageName, options.registry);
  await run(plan.command, plan.arguments);
  return { version: candidate.version, published: options.packageName };
}

function runCommand(command, arguments_, { capture = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArguments =
      process.platform === 'win32' ? ['/d', '/s', '/c', command, ...arguments_] : arguments_;
    const child = spawn(executable, executableArguments, {
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
    child.on('close', (code, signal) => {
      if (code === 0) resolveRun(capture ? stdout : undefined);
      else
        reject(
          new Error(
            signal
              ? `${command} ended with ${signal}`
              : `${command} exited with ${code}${stderr ? `: ${sanitizeRegistryResponse(stderr)}` : ''}`,
          ),
        );
    });
  });
}

function usage() {
  return 'Usage: node scripts/publish-release-candidate.mjs <verify|publish> --manifest <path> --version <exact-version> [--package <smocket|smocket-client>] [--registry <https-url>]';
}

async function main() {
  const options = parsePublicationOptions(process.argv.slice(2));
  const result = await executePublication(options);
  if (result.published) console.log(`published ${result.published}@${result.version}`);
  else console.log(`release candidate matches requested version ${result.version}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
