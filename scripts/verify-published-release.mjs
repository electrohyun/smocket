import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const releasedPackages = ['smocket', 'smocket-client'];
const defaultRegistry = 'https://registry.npmjs.org/';
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = dirname(dirname(scriptPath));

export function parsePublishedVerificationOptions(arguments_) {
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(
        'Usage: node scripts/verify-published-release.mjs --version <exact-version> [--attempts <positive-integer>] [--delay-ms <non-negative-integer>] [--registry <https-url>]',
      );
    }
    if (!new Set(['--version', '--attempts', '--delay-ms', '--registry']).has(flag)) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (options.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    options.set(flag, value);
  }

  const version = options.get('--version') ?? '';
  assert.match(version, exactVersionPattern, '--version must be an exact npm version');
  const attempts = parseIntegerOption(options.get('--attempts') ?? '6', '--attempts', 1, 20);
  const delayMs = parseIntegerOption(
    options.get('--delay-ms') ?? '10000',
    '--delay-ms',
    0,
    300_000,
  );
  const registry = new URL(options.get('--registry') ?? defaultRegistry);
  assert.equal(registry.protocol, 'https:', '--registry must use HTTPS');
  assert.equal(registry.username, '', '--registry must not contain credentials');
  assert.equal(registry.password, '', '--registry must not contain credentials');
  assert.equal(registry.search, '', '--registry must not contain query parameters');
  assert.equal(registry.hash, '', '--registry must not contain a fragment');

  return { version, attempts, delayMs, registry: registry.href };
}

function parseIntegerOption(value, name, minimum, maximum) {
  assert.match(value, /^\d+$/, `${name} must be an integer`);
  const parsed = Number(value);
  assert.ok(
    Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum,
    `${name} is out of range`,
  );
  return parsed;
}

export function sanitizeRegistryResponse(value) {
  return String(value)
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[credentials]@')
    .replace(/(_authToken\s*[=:]\s*)\S+/giu, '$1[redacted]')
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/gu, '[redacted npm token]')
    .trim()
    .slice(0, 1000);
}

export async function verifyRegistryVisibility({
  packages = releasedPackages,
  version,
  attempts,
  delayMs,
  lookup,
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  report = () => {},
}) {
  const pending = new Set(packages);
  const lastResponses = new Map();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const packageName of [...pending]) {
      const result = await lookup(packageName, version);
      const response = sanitizeRegistryResponse(result.response || 'no registry response');
      lastResponses.set(packageName, response);
      report({ packageName, version, attempt, attempts, ...result, response });
      if (result.ok && result.version === version) pending.delete(packageName);
    }

    if (pending.size === 0) return;
    if (attempt < attempts) await sleep(delayMs);
  }

  const detail = [...pending]
    .map(
      (packageName) =>
        `${packageName}@${version}: ${lastResponses.get(packageName) ?? 'no registry response'}`,
    )
    .join('\n');
  throw new Error(
    `Registry visibility exhausted after ${attempts} attempt(s) for exact release:\n${detail}`,
  );
}

function run(command, args, { cwd = repositoryRoot, capture = false, environment = {} } = {}) {
  return new Promise((resolveRun) => {
    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false', ...environment },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) =>
      resolveRun({ code: null, stdout, stderr: `could not start ${command}: ${error.message}` }),
    );
    child.on('exit', (code, signal) =>
      resolveRun({ code, stdout, stderr: signal ? `terminated by ${signal}\n${stderr}` : stderr }),
    );
  });
}

async function lookupPublishedVersion(packageName, version, registry) {
  const result = await run(
    'npm',
    ['view', `${packageName}@${version}`, 'version', '--json', '--registry', registry],
    { capture: true },
  );
  const response = sanitizeRegistryResponse(
    result.stderr || result.stdout || `exit ${result.code}`,
  );
  if (result.code !== 0) return { ok: false, response };

  try {
    const registryVersion = JSON.parse(result.stdout);
    return { ok: registryVersion === version, version: registryVersion, response };
  } catch (error) {
    return {
      ok: false,
      response: `invalid registry JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function main() {
  const options = parsePublishedVerificationOptions(process.argv.slice(2));
  await verifyRegistryVisibility({
    ...options,
    lookup: (packageName, version) =>
      lookupPublishedVersion(packageName, version, options.registry),
    report: ({ packageName, version, attempt, attempts, ok, response }) => {
      const state = ok ? 'visible' : 'unavailable';
      console.log(
        `${packageName}@${version} attempt ${attempt}/${attempts}: ${state}; ${response}`,
      );
    },
  });

  const consumer = await run(
    process.execPath,
    [
      'scripts/run-clean-adoption.mjs',
      'published',
      '--version',
      options.version,
      '--client-version',
      options.version,
    ],
    { environment: { npm_config_registry: options.registry } },
  );
  if (consumer.code !== 0) throw new Error(`exact published consumer exited with ${consumer.code}`);
  console.log(`exact published release ${options.version} passed`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) await main();
