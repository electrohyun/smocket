import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  checkPackedPackage,
  inspectRootPackagePolicy,
  isBundledDependencyEntry,
  normalizeTarEntryPath,
} from './check-packed-package.mjs';
import { inspectClientPackagePolicy } from './check-client-package.mjs';
import { assertCandidatePackageIdentities } from './chat-room-consumer-validation.mjs';
import { detectExternalImports } from './detect-external-imports.js';
import { loadReleaseCandidate } from './release-candidate.mjs';

const emptyManifest = { name: 'smocket', version: '0.0.0' };

function inspect({
  sourceManifest = emptyManifest,
  packedManifest = emptyManifest,
  tarEntries = ['package/package.json', 'package/dist/index.js'],
}: {
  sourceManifest?: Record<string, unknown>;
  packedManifest?: Record<string, unknown>;
  tarEntries?: string[];
} = {}) {
  return inspectRootPackagePolicy({ sourceManifest, packedManifest, tarEntries });
}

describe('root package manifest policy', () => {
  it('returns evidence for both manifests and the packed payload', () => {
    const result = inspect({
      sourceManifest: {
        ...emptyManifest,
        dependencies: {},
        optionalDependencies: {},
        peerDependencies: {},
        peerDependenciesMeta: {},
        bundleDependencies: false,
        bundledDependencies: [],
      },
      packedManifest: emptyManifest,
    });

    expect(result).toMatchObject({
      passed: true,
      violations: [],
      evidence: {
        manifests: [
          {
            location: 'source manifest',
            fields: {
              dependencies: 'empty',
              optionalDependencies: 'empty',
              peerDependencies: 'empty',
              peerDependenciesMeta: 'empty',
              bundleDependencies: 'empty',
              bundledDependencies: 'empty',
            },
          },
          {
            location: 'packed manifest',
            fields: {
              dependencies: 'absent',
              optionalDependencies: 'absent',
              peerDependencies: 'absent',
              peerDependenciesMeta: 'absent',
              bundleDependencies: 'absent',
              bundledDependencies: 'absent',
            },
          },
        ],
        tarball: { entriesInspected: 2, bundledDependencyEntries: [] },
      },
    });
  });

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'])(
    'rejects non-empty %s in either manifest',
    (field) => {
      for (const location of ['sourceManifest', 'packedManifest'] as const) {
        const result = inspect({
          [location]: { ...emptyManifest, [field]: { forbidden: '1.0.0' } },
        });

        expect(result.passed).toBe(false);
        expect(result.violations).toEqual([
          {
            code: 'runtime-manifest-field',
            location: location === 'sourceManifest' ? 'source manifest' : 'packed manifest',
            field,
            detail: 'forbidden',
          },
        ]);
      }
    },
  );

  it.each(['bundleDependencies', 'bundledDependencies'])(
    'allows false or an empty list for %s',
    (field) => {
      expect(inspect({ sourceManifest: { ...emptyManifest, [field]: false } }).passed).toBe(true);
      expect(inspect({ packedManifest: { ...emptyManifest, [field]: [] } }).passed).toBe(true);
    },
  );

  it.each(['bundleDependencies', 'bundledDependencies'])(
    'rejects true or a non-empty list for %s in either manifest',
    (field) => {
      const sourceResult = inspect({ sourceManifest: { ...emptyManifest, [field]: true } });
      const packedResult = inspect({
        packedManifest: { ...emptyManifest, [field]: ['forbidden'] },
      });

      expect(sourceResult.violations).toContainEqual({
        code: 'bundle-manifest-field',
        location: 'source manifest',
        field,
        detail: 'true',
      });
      expect(packedResult.violations).toContainEqual({
        code: 'bundle-manifest-field',
        location: 'packed manifest',
        field,
        detail: '["forbidden"]',
      });
    },
  );

  it.each([
    ['dependencies', []],
    ['optionalDependencies', false],
    ['peerDependencies', null],
    ['peerDependenciesMeta', ''],
    ['bundleDependencies', {}],
    ['bundledDependencies', null],
  ])('rejects an invalid empty-looking value for %s', (field, value) => {
    const result = inspect({ sourceManifest: { ...emptyManifest, [field]: value } });

    expect(result.passed).toBe(false);
    expect(result.violations[0]).toMatchObject({
      location: 'source manifest',
      field,
    });
  });
});

describe('packed payload policy', () => {
  it.each([
    'package/node_modules/forbidden/index.js',
    './package/node_modules/forbidden/index.js',
    'package\\node_modules\\forbidden\\index.js',
    'C:\\package\\NODE_MODULES\\forbidden\\index.js',
  ])('rejects a bundled dependency entry at %s', (path) => {
    const result = inspect({ tarEntries: ['package/package.json', path] });

    expect(isBundledDependencyEntry(path)).toBe(true);
    expect(result.violations).toContainEqual({
      code: 'bundled-dependency-payload',
      location: 'packed tarball',
      field: 'node_modules',
      detail: normalizeTarEntryPath(path),
    });
  });

  it('does not confuse a similarly named path with node_modules', () => {
    expect(inspect({ tarEntries: ['package/not-node_modules/index.js'] }).passed).toBe(true);
  });
});

describe('client facade package policy', () => {
  const rootManifest = { name: 'smocket', version: '1.2.3' };
  const clientManifest = {
    name: 'smocket-client',
    version: '1.2.3',
    peerDependencies: { smocket: '1.2.3' },
  };
  const clientTarEntries = [
    'package/package.json',
    'package/LICENSE',
    'package/README.md',
    'package/dist/index.mjs',
  ];

  function inspectClient(
    sourceManifest: Record<string, unknown> = clientManifest,
    packedManifest: Record<string, unknown> = clientManifest,
    tarEntries = clientTarEntries,
  ) {
    return inspectClientPackagePolicy({
      rootManifest,
      sourceManifest,
      packedManifest,
      tarEntries,
    });
  }

  it('accepts synchronized manifests with one exact peer and no bundled payload', () => {
    expect(inspectClient()).toEqual({ passed: true, violations: [] });
  });

  it('rejects a source or packed version that differs from the root', () => {
    expect(inspectClient({ ...clientManifest, version: '1.2.4' }).violations).toContain(
      'source manifest version must equal smocket 1.2.3',
    );
    expect(
      inspectClient(clientManifest, { ...clientManifest, version: '1.2.4' }).violations,
    ).toContain('packed manifest version must equal smocket 1.2.3');
  });

  it('rejects a range, an extra peer, and a runtime dependency', () => {
    const invalid = {
      ...clientManifest,
      dependencies: { helper: '1.0.0' },
      peerDependencies: { smocket: '^1.2.3', helper: '1.0.0' },
    };
    const result = inspectClient(invalid);

    expect(result.violations).toContain(
      'source manifest must have only the exact smocket 1.2.3 peer',
    );
    expect(result.violations).toContain('source manifest dependencies must be absent or empty');
  });

  it('rejects a bundled dependency entry', () => {
    const result = inspectClient(clientManifest, clientManifest, [
      ...clientTarEntries,
      'package/node_modules/smocket/dist/index.js',
    ]);

    expect(result.violations).toContain(
      'packed tarball must not contain package/node_modules/smocket/dist/index.js',
    );
  });

  it.each(['package/LICENSE', 'package/README.md'])(
    'rejects a client tarball without %s',
    (missingEntry) => {
      const tarEntries = clientTarEntries.filter((entry) => entry !== missingEntry);

      expect(inspectClient(clientManifest, clientManifest, tarEntries).violations).toContain(
        `packed tarball must contain ${missingEntry}`,
      );
    },
  );

  it.each([
    ['leading dot prefixes', './package/LICENSE', './package/README.md'],
    ['backslash separators', 'package\\LICENSE', 'package\\README.md'],
    ['empty and dot segments', 'package//LICENSE', 'package/./README.md'],
  ])('accepts required files with %s', (_variant, licenseEntry, readmeEntry) => {
    const tarEntries = [
      'package/package.json',
      licenseEntry,
      readmeEntry,
      'package/dist/index.mjs',
    ];

    expect(inspectClient(clientManifest, clientManifest, tarEntries)).toEqual({
      passed: true,
      violations: [],
    });
  });
});

describe('chat-room candidate package identity', () => {
  const version = '0.5.0';
  const rootPackage = { name: 'smocket', version };
  const clientPackage = { name: 'smocket-client', version };

  it('accepts the synchronized root and client packages', () => {
    expect(() =>
      assertCandidatePackageIdentities(rootPackage, clientPackage, version),
    ).not.toThrow();
  });

  it('rejects the root package supplied to both candidate slots', () => {
    expect(() => assertCandidatePackageIdentities(rootPackage, rootPackage, version)).toThrow(
      'client candidate must install smocket-client',
    );
  });

  it('rejects an invalid root package name', () => {
    const invalidRootPackage = { ...rootPackage, name: 'not-smocket' };

    expect(() =>
      assertCandidatePackageIdentities(invalidRootPackage, clientPackage, version),
    ).toThrow('root candidate must install smocket');
  });

  it('rejects root and client versions that do not match the candidate', () => {
    const wrongVersion = '0.5.1';

    expect(() =>
      assertCandidatePackageIdentities(
        { ...rootPackage, version: wrongVersion },
        clientPackage,
        version,
      ),
    ).toThrow(`root candidate version must match ${version}`);
    expect(() =>
      assertCandidatePackageIdentities(
        rootPackage,
        { ...clientPackage, version: wrongVersion },
        version,
      ),
    ).toThrow(`client candidate version must match ${version}`);
  });
});

it('rejects the lock-consistent unused runtime dependency fixture after packing it', async () => {
  const scriptsRoot = dirname(fileURLToPath(import.meta.url));
  const fixtureRoot = join(scriptsRoot, 'fixtures', 'unused-runtime-dependency');
  const manifest = JSON.parse(await readFile(join(fixtureRoot, 'package.json'), 'utf8'));
  const lockfile = JSON.parse(await readFile(join(fixtureRoot, 'package-lock.json'), 'utf8'));
  const source = await readFile(join(fixtureRoot, 'index.js'), 'utf8');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-package-fixture-'));
  const packageRoot = join(temporaryRoot, 'package');

  expect(lockfile.packages[''].dependencies).toEqual(manifest.dependencies);
  expect(detectExternalImports(source)).toEqual([]);

  try {
    await cp(fixtureRoot, packageRoot, { recursive: true });
    const installedDependencyRoot = join(packageRoot, 'node_modules', 'unused-runtime-dependency');
    // npm installation is fixture setup, not the behavior under test. Materialize
    // the exact locked file dependency so only the two npm pack inspections spawn.
    await mkdir(dirname(installedDependencyRoot), { recursive: true });
    await cp(join(packageRoot, 'dependency'), installedDependencyRoot, { recursive: true });
    expect(
      JSON.parse(await readFile(join(installedDependencyRoot, 'package.json'), 'utf8')),
    ).toEqual({
      name: lockfile.packages['dependency'].name,
      version: lockfile.packages['dependency'].version,
    });

    const result = await checkPackedPackage(packageRoot);

    expect(result.passed).toBe(false);
    expect(result.evidence.sourceManifest).toBe(join(packageRoot, 'package.json'));
    expect(result.evidence.packedManifest).toMatch(/\.tgz:package\/package\.json$/);
    expect(result.violations).toEqual([
      {
        code: 'runtime-manifest-field',
        location: 'source manifest',
        field: 'dependencies',
        detail: 'unused-runtime-dependency',
      },
      {
        code: 'runtime-manifest-field',
        location: 'packed manifest',
        field: 'dependencies',
        detail: 'unused-runtime-dependency',
      },
    ]);

    manifest.bundleDependencies = ['unused-runtime-dependency'];
    await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const bundledResult = await checkPackedPackage(packageRoot);

    expect(bundledResult.evidence.tarball.bundledDependencyEntries).toContain(
      'package/node_modules/unused-runtime-dependency/package.json',
    );
    expect(bundledResult.violations).toContainEqual({
      code: 'bundled-dependency-payload',
      location: 'packed tarball',
      field: 'node_modules',
      detail: 'package/node_modules/unused-runtime-dependency/package.json',
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}, 20_000); // Windows process startup and two npm pack runs can exceed Vitest's 5s default.

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function packFixture(packageRoot: string, outputRoot: string) {
  const args = ['pack', '.', '--ignore-scripts', '--pack-destination', outputRoot];
  const useWindowsCommandShell = process.platform === 'win32';
  const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', 'npm', ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: packageRoot,
    env: {
      ...process.env,
      npm_config_cache: join(outputRoot, '.npm-cache'),
      npm_config_update_notifier: 'false',
    },
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}

async function makeCandidateFixture() {
  const root = await mkdtemp(join(tmpdir(), 'smocket-release-candidate-test-'));
  const output = join(root, 'candidate');
  const rootPackage = join(root, 'root-package');
  const clientPackage = join(root, 'client-package');
  await Promise.all([mkdir(output), mkdir(rootPackage), mkdir(clientPackage)]);
  await writeJson(join(rootPackage, 'package.json'), {
    name: 'smocket',
    version: '1.2.3',
  });
  await writeJson(join(clientPackage, 'package.json'), {
    name: 'smocket-client',
    version: '1.2.3',
    peerDependencies: { smocket: '1.2.3' },
  });
  await packFixture(rootPackage, output);
  await packFixture(clientPackage, output);

  const entries = await Promise.all(
    (
      [
        ['smocket', 'smocket-1.2.3.tgz'],
        ['smocket-client', 'smocket-client-1.2.3.tgz'],
      ] as const
    ).map(async ([name, filename]) => {
      const archivePath = join(output, filename);
      const archive = await readFile(archivePath);
      return {
        name,
        version: '1.2.3',
        filename,
        sha256: createHash('sha256').update(archive).digest('hex'),
        size: (await stat(archivePath)).size,
      };
    }),
  );
  const manifestPath = join(output, 'release-candidate.json');
  await writeJson(manifestPath, { schemaVersion: 1, version: '1.2.3', packages: entries });
  return { root, output, manifestPath };
}

describe('immutable release candidate manifest', () => {
  it('loads a synchronized digest-verified two-package candidate', async () => {
    const candidate = await makeCandidateFixture();
    try {
      await expect(loadReleaseCandidate(candidate.manifestPath)).resolves.toMatchObject({
        version: '1.2.3',
        rootTarball: join(candidate.output, 'smocket-1.2.3.tgz'),
        clientTarball: join(candidate.output, 'smocket-client-1.2.3.tgz'),
      });
    } finally {
      await rm(candidate.root, { recursive: true, force: true });
    }
  });

  it('rejects a candidate tarball changed after manifest creation', async () => {
    const candidate = await makeCandidateFixture();
    try {
      const archivePath = join(candidate.output, 'smocket-1.2.3.tgz');
      const archive = await readFile(archivePath);
      const lastByte = archive.length - 1;
      archive[lastByte] = (archive[lastByte] ?? 0) ^ 1;
      await writeFile(archivePath, archive);
      await expect(loadReleaseCandidate(candidate.manifestPath)).rejects.toThrow(
        'smocket candidate digest changed after manifest creation',
      );
    } finally {
      await rm(candidate.root, { recursive: true, force: true });
    }
  });

  it('rejects archive paths outside the candidate directory', async () => {
    const candidate = await makeCandidateFixture();
    try {
      const manifest = JSON.parse(await readFile(candidate.manifestPath, 'utf8'));
      manifest.packages[0].filename = '../smocket-1.2.3.tgz';
      await writeJson(candidate.manifestPath, manifest);
      await expect(loadReleaseCandidate(candidate.manifestPath)).rejects.toThrow(
        'Invalid smocket release candidate entry',
      );
    } finally {
      await rm(candidate.root, { recursive: true, force: true });
    }
  });
});
