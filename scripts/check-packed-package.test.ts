import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { detectExternalImports } from './detect-external-imports.js';

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

  function inspectClient(
    sourceManifest: Record<string, unknown> = clientManifest,
    packedManifest: Record<string, unknown> = clientManifest,
    tarEntries = ['package/package.json', 'package/dist/index.mjs'],
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
      'package/package.json',
      'package/node_modules/smocket/dist/index.js',
    ]);

    expect(result.violations).toContain(
      'packed tarball must not contain package/node_modules/smocket/dist/index.js',
    );
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
    const npmArguments = ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'];
    const useWindowsCommandShell = process.platform === 'win32';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
    const executableArguments = useWindowsCommandShell
      ? ['/d', '/s', '/c', 'npm', ...npmArguments]
      : npmArguments;
    const install = spawnSync(executable, executableArguments, {
      cwd: packageRoot,
      env: {
        ...process.env,
        npm_config_cache: join(temporaryRoot, 'npm-cache'),
        npm_config_update_notifier: 'false',
      },
      encoding: 'utf8',
    });
    expect(install.error).toBeUndefined();
    expect(install.status, install.stderr).toBe(0);

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
