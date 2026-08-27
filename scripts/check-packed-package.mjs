import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const EMPTY_OBJECT_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
];
const BUNDLE_FIELDS = ['bundleDependencies', 'bundledDependencies'];
export const PUBLIC_NPM_PUBLISH_CONFIG = Object.freeze({
  access: 'public',
  registry: 'https://registry.npmjs.org/',
});

export function hasPublicNpmPublishConfig(manifest) {
  const config = manifest.publishConfig;
  return (
    typeof config === 'object' &&
    config !== null &&
    !Array.isArray(config) &&
    Object.keys(config).length === 2 &&
    config.access === PUBLIC_NPM_PUBLISH_CONFIG.access &&
    config.registry === PUBLIC_NPM_PUBLISH_CONFIG.registry
  );
}

function run(command, args, cwd, environmentOverrides = {}) {
  return new Promise((resolvePromise, reject) => {
    const environment = {
      ...process.env,
      npm_config_update_notifier: 'false',
      ...environmentOverrides,
    };
    delete environment.npm_config_manage_package_manager_versions;

    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: environment,
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
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} was terminated by ${signal}`
            : `${command} exited with code ${code}${stderr ? `:\n${stderr}` : ''}`,
        ),
      );
    });
  });
}

function readTarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  const boundary = end === -1 || end > offset + length ? offset + length : end;
  return buffer.toString('utf8', offset, boundary);
}

function readTarSize(buffer, offset) {
  const bytes = buffer.subarray(offset, offset + 12);
  if ((bytes[0] ?? 0) & 0x80) {
    throw new Error('Cannot inspect a tar entry with a base-256 size');
  }

  const value = bytes.toString('ascii').replaceAll('\0', '').trim();
  if (value === '') {
    return 0;
  }
  if (!/^[0-7]+$/.test(value)) {
    throw new Error(`Cannot inspect invalid tar entry size ${JSON.stringify(value)}`);
  }
  return Number.parseInt(value, 8);
}

function readPaxPath(buffer) {
  let offset = 0;
  let path;

  while (offset < buffer.length) {
    const space = buffer.indexOf(0x20, offset);
    if (space === -1) {
      throw new Error('Cannot inspect malformed PAX metadata');
    }
    const recordLength = Number.parseInt(buffer.toString('ascii', offset, space), 10);
    if (!Number.isSafeInteger(recordLength) || recordLength <= 0) {
      throw new Error('Cannot inspect malformed PAX record length');
    }
    const recordEnd = offset + recordLength;
    if (recordEnd > buffer.length) {
      throw new Error('Cannot inspect truncated PAX metadata');
    }
    const record = buffer.toString('utf8', space + 1, recordEnd - 1);
    const equals = record.indexOf('=');
    if (equals !== -1 && record.slice(0, equals) === 'path') {
      path = record.slice(equals + 1);
    }
    offset = recordEnd;
  }

  return path;
}

export function normalizeTarEntryPath(path) {
  return path
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '')
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');
}

export function isBundledDependencyEntry(path) {
  return normalizeTarEntryPath(path)
    .split('/')
    .some((part) => part.toLowerCase() === 'node_modules');
}

export function readTarEntries(archive) {
  const tar = gunzipSync(archive);
  const entries = [];
  let offset = 0;
  let nextPath;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const size = readTarSize(header, 124);
    const type = String.fromCharCode(header[156] ?? 0);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tar.length) {
      throw new Error(`Cannot inspect truncated tar entry ${JSON.stringify(headerPath)}`);
    }
    const content = tar.subarray(contentStart, contentEnd);

    if (type === 'g') {
      // Global PAX records do not name the next entry. Ignore their metadata.
    } else if (type === 'x') {
      nextPath = readPaxPath(content) ?? nextPath;
    } else if (type === 'L') {
      nextPath = readTarString(content, 0, content.length);
    } else {
      entries.push({
        path: normalizeTarEntryPath(nextPath ?? headerPath),
        content,
        type,
      });
      nextPath = undefined;
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return entries;
}

export function readPackedPackage(archive) {
  const entries = readTarEntries(archive);
  const manifestEntries = entries.filter(
    (entry) => entry.path === 'package/package.json' && !['1', '2', '5'].includes(entry.type),
  );
  if (manifestEntries.length !== 1) {
    throw new Error(
      `Packed tarball must contain exactly one package/package.json; found ${manifestEntries.length}`,
    );
  }
  return {
    entries,
    manifest: JSON.parse(manifestEntries[0].content.toString('utf8')),
  };
}

function isEmptyObject(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function isAllowedBundleValue(value) {
  return value === false || (Array.isArray(value) && value.length === 0);
}

function fieldState(manifest, field, allowBundleValue) {
  if (!Object.hasOwn(manifest, field)) {
    return 'absent';
  }
  if (allowBundleValue ? isAllowedBundleValue(manifest[field]) : isEmptyObject(manifest[field])) {
    return 'empty';
  }
  return 'non-empty';
}

function describeValue(value) {
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : JSON.stringify(value);
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    return keys.length === 0 ? '{}' : keys.join(', ');
  }
  return JSON.stringify(value);
}

export function inspectRootPackagePolicy({ sourceManifest, packedManifest, tarEntries }) {
  const violations = [];
  const manifests = [
    ['source manifest', sourceManifest],
    ['packed manifest', packedManifest],
  ];
  const manifestEvidence = [];

  for (const [location, manifest] of manifests) {
    const fields = {};
    fields.publishConfig = hasPublicNpmPublishConfig(manifest) ? 'canonical' : 'invalid';
    if (fields.publishConfig === 'invalid') {
      violations.push({
        code: 'publish-config',
        location,
        field: 'publishConfig',
        detail: 'must select public access on https://registry.npmjs.org/',
      });
    }
    for (const field of EMPTY_OBJECT_FIELDS) {
      const state = fieldState(manifest, field, false);
      fields[field] = state;
      if (state === 'non-empty') {
        violations.push({
          code: 'runtime-manifest-field',
          location,
          field,
          detail: describeValue(manifest[field]),
        });
      }
    }
    for (const field of BUNDLE_FIELDS) {
      const state = fieldState(manifest, field, true);
      fields[field] = state;
      if (state === 'non-empty') {
        violations.push({
          code: 'bundle-manifest-field',
          location,
          field,
          detail: describeValue(manifest[field]),
        });
      }
    }
    manifestEvidence.push({ location, fields });
  }

  const normalizedEntries = tarEntries.map(normalizeTarEntryPath);
  const bundledDependencyEntries = normalizedEntries.filter(isBundledDependencyEntry);
  for (const path of bundledDependencyEntries) {
    violations.push({
      code: 'bundled-dependency-payload',
      location: 'packed tarball',
      field: 'node_modules',
      detail: path,
    });
  }

  return {
    passed: violations.length === 0,
    violations,
    evidence: {
      manifests: manifestEvidence,
      tarball: {
        entriesInspected: normalizedEntries.length,
        bundledDependencyEntries,
      },
    },
  };
}

function parsePackOutput(stdout) {
  let result;
  try {
    result = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm pack did not return JSON: ${stdout}`, { cause: error });
  }
  if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.filename !== 'string') {
    throw new Error('npm pack must produce exactly one tarball');
  }
  return result[0].filename;
}

export async function checkPackedPackage(packageRoot, suppliedArchivePath) {
  const resolvedRoot = resolve(packageRoot);
  const sourceManifestPath = join(resolvedRoot, 'package.json');
  const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-package-policy-'));

  try {
    let archivePath;
    if (suppliedArchivePath === undefined) {
      const { stdout } = await run(
        'npm',
        ['pack', '.', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
        resolvedRoot,
        { npm_config_cache: join(temporaryRoot, 'npm-cache') },
      );
      const filename = parsePackOutput(stdout);
      const archives = (await readdir(temporaryRoot)).filter((file) => file.endsWith('.tgz'));
      if (archives.length !== 1 || archives[0] !== basename(filename)) {
        throw new Error('npm pack must produce exactly the reported tarball');
      }
      archivePath = join(temporaryRoot, archives[0]);
    } else {
      archivePath = resolve(suppliedArchivePath);
    }

    const { entries, manifest: packedManifest } = readPackedPackage(await readFile(archivePath));
    const result = inspectRootPackagePolicy({
      sourceManifest,
      packedManifest,
      tarEntries: entries.map((entry) => entry.path),
    });

    return {
      ...result,
      evidence: {
        ...result.evidence,
        sourceManifest: sourceManifestPath,
        packedManifest: `${basename(archivePath)}:package/package.json`,
        tarball: {
          ...result.evidence.tarball,
          filename: basename(archivePath),
        },
      },
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function formatViolation(violation) {
  if (violation.code === 'bundled-dependency-payload') {
    return `  ${violation.location}: ${violation.detail}`;
  }
  return `  ${violation.location} ${violation.field}: ${violation.detail}`;
}

async function main() {
  const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const tarballIndex = process.argv.indexOf('--tarball');
  const tarball = tarballIndex === -1 ? undefined : process.argv[tarballIndex + 1];
  if (tarballIndex !== -1 && (tarball === undefined || tarball.startsWith('--'))) {
    throw new Error('--tarball requires a path');
  }
  const positional = process.argv[2]?.startsWith('--') === false ? process.argv[2] : undefined;
  const packageRoot = positional ? resolve(positional) : repositoryRoot;
  const result = await checkPackedPackage(packageRoot, tarball);

  if (!result.passed) {
    console.error(
      `The root package must ship with zero runtime dependencies:\n${result.violations
        .map(formatViolation)
        .join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Package policy passed for ${result.evidence.sourceManifest}, ` +
      `${result.evidence.packedManifest}, and ${result.evidence.tarball.entriesInspected} tar entries.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
