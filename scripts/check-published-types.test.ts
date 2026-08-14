import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  baseManifests,
  executePublishedTypeCheck,
  parsePublishedTypeOptions,
} from './check-published-types.mjs';
import {
  breakingTypeBumpIsAdequate,
  compareDeclarationFixture,
  compareExactVersions,
  requiredBreakingTypeBump,
  selectPublishedPredecessor,
  versionChangePlan,
} from './published-type-compatibility.mjs';

const fixtureRoot = fileURLToPath(
  new URL('./fixtures/published-type-compatibility/', import.meta.url),
);

type PackageManifest = {
  name: string;
  version: string;
  peerDependencies?: { smocket: string };
};

type CompatibilityIssue = {
  shape: string;
  reason: string;
  entrypoint?: string;
  previous?: string;
  candidate?: string;
};

function manifest(name: string, version: string): PackageManifest {
  return {
    name,
    version,
    ...(name === 'smocket-client' ? { peerDependencies: { smocket: version } } : {}),
  };
}

function manifests(version: string) {
  return {
    smocket: manifest('smocket', version),
    'smocket-client': manifest('smocket-client', version),
  };
}

function changes(baseVersion: string, candidateVersion: string) {
  return versionChangePlan(manifests(baseVersion), manifests(candidateVersion));
}

describe('published type version planning', () => {
  it('detects only synchronized version increases', () => {
    expect(versionChangePlan(manifests('0.5.0'), manifests('0.5.0'))).toEqual([]);
    expect(changes('0.5.0', '0.5.1')).toEqual([
      { packageName: 'smocket', baseVersion: '0.5.0', candidateVersion: '0.5.1' },
      { packageName: 'smocket-client', baseVersion: '0.5.0', candidateVersion: '0.5.1' },
    ]);

    const split = manifests('0.5.1');
    split['smocket-client'].version = '0.5.0';
    split['smocket-client'].peerDependencies = { smocket: '0.5.1' };
    expect(() => versionChangePlan(manifests('0.5.0'), split)).toThrow('change together');
    expect(() => changes('0.5.0', '0.4.9')).toThrow('must increase');

    const desynchronized = manifests('0.6.0');
    desynchronized['smocket-client'].version = '0.5.2';
    expect(() => versionChangePlan(manifests('0.5.0'), desynchronized)).toThrow('synchronized');

    const loosePeer = manifests('0.6.0');
    loosePeer['smocket-client'].peerDependencies = { smocket: '^0.6.0' };
    expect(() => versionChangePlan(manifests('0.5.0'), loosePeer)).toThrow('exact peer');
  });

  it('selects the exact greatest published version below the candidate', () => {
    expect(selectPublishedPredecessor(['0.4.2', '0.5.0-beta.1', '0.5.0', '0.6.0'], '0.5.1')).toBe(
      '0.5.0',
    );
    expect(selectPublishedPredecessor([], '0.5.0')).toBeUndefined();
    expect(compareExactVersions('0.5.0-beta.1', '0.5.0')).toBeLessThan(0);
  });

  it('applies the ADR 0019 type row one place to the right before 1.0.0', () => {
    expect(requiredBreakingTypeBump('0.5.0')).toBe('minor');
    expect(breakingTypeBumpIsAdequate('0.5.0', '0.5.1')).toBe(false);
    expect(breakingTypeBumpIsAdequate('0.5.0', '0.6.0')).toBe(true);
    expect(requiredBreakingTypeBump('1.2.0')).toBe('major');
    expect(breakingTypeBumpIsAdequate('1.2.0', '1.3.0')).toBe(false);
    expect(breakingTypeBumpIsAdequate('1.2.0', '2.0.0')).toBe(true);
  });

  it('parses only the read-only detect and check commands', () => {
    expect(parsePublishedTypeOptions(['detect', '--base', 'a'.repeat(40)])).toMatchObject({
      command: 'detect',
      base: 'a'.repeat(40),
    });
    expect(() => parsePublishedTypeOptions(['check', '--base', 'a'.repeat(40)])).toThrow(
      '--manifest',
    );
    expect(() =>
      parsePublishedTypeOptions([
        'check',
        '--base',
        'a'.repeat(40),
        '--manifest',
        'candidate.json',
        '--registry',
        'https://user:secret@registry.example/',
      ]),
    ).toThrow('credentials');
  });

  it('reads both package versions from an exact base commit', async () => {
    const execute = vi.fn(async (_command: string, arguments_: string[]) => ({
      code: 0,
      signal: null,
      stdout: JSON.stringify(
        arguments_[1]?.endsWith(':package.json')
          ? manifest('smocket', '0.5.0')
          : manifest('smocket-client', '0.5.0'),
      ),
      stderr: '',
    }));

    await expect(baseManifests('a'.repeat(40), execute)).resolves.toEqual(manifests('0.5.0'));
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe('published declaration compatibility', () => {
  const previous = `${fixtureRoot}/previous.d.ts`;

  it('accepts additions that preserve existing call sites', async () => {
    await expect(
      compareDeclarationFixture(previous, `${fixtureRoot}/compatible.d.ts`),
    ).resolves.toEqual([]);
  });

  it.each([
    ['narrowed-event-parameter.d.ts', 'Socket.emit', 'call signature changed incompatibly'],
    ['readonly-property.d.ts', 'Socket.label', 'writable property became readonly'],
    ['required-member.d.ts', 'Socket.trace', 'required public member was added'],
    ['return-type.d.ts', 'Socket.transform', 'call signature changed incompatibly'],
  ])('detects %s', async (candidate, shape, reason) => {
    const issues = await compareDeclarationFixture(previous, `${fixtureRoot}/${candidate}`);
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ shape, reason })]));
  });

  it('resolves a changed private alias behind an unchanged public signature', async () => {
    const issues = await compareDeclarationFixture(
      `${fixtureRoot}/alias-previous.d.ts`,
      `${fixtureRoot}/alias-narrowed.d.ts`,
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shape: 'Payload',
          reason: 'type changed incompatibly',
        }),
      ]),
    );
  });
});

describe('published type check result', () => {
  function dependencies(
    issuesByPackage: Record<string, CompatibilityIssue[]>,
    versions = ['0.5.0'],
  ) {
    return {
      listVersions: vi.fn(async (_packageName: string, _registry: string) => versions),
      fetchArchive: vi.fn(
        async (packageName: string, version: string) => `${packageName}-${version}.tgz`,
      ),
      readArchiveManifest: vi.fn(async () => manifest('smocket-client', '0.5.0')),
      inspectComparison: vi.fn(
        async ({ packageName }: { packageName: string }) => issuesByPackage[packageName] ?? [],
      ),
      report: vi.fn(),
    };
  }

  it('does not query the registry when no publishable version changed', async () => {
    const injected = dependencies({});
    await expect(
      executePublishedTypeCheck({
        changes: [],
        candidate: {
          version: '0.5.0',
          rootTarball: 'candidate-smocket.tgz',
          clientTarball: 'candidate-smocket-client.tgz',
        },
        registry: 'https://registry.npmjs.org/',
        ...injected,
      }),
    ).resolves.toEqual({ checked: [], skipped: ['smocket', 'smocket-client'] });
    expect(injected.listVersions).not.toHaveBeenCalled();
    expect(injected.fetchArchive).not.toHaveBeenCalled();
    expect(injected.inspectComparison).not.toHaveBeenCalled();
  });

  it('fails a patch when a previously accepted call-site shape breaks', async () => {
    const injected = dependencies({
      smocket: [{ shape: 'Socket.emit', reason: 'call signature changed incompatibly' }],
    });
    await expect(
      executePublishedTypeCheck({
        changes: changes('0.5.0', '0.5.1'),
        candidate: {
          version: '0.5.1',
          rootTarball: 'candidate-smocket.tgz',
          clientTarball: 'candidate-smocket-client.tgz',
        },
        registry: 'https://registry.npmjs.org/',
        ...injected,
      }),
    ).rejects.toThrow('requires at least a minor bump');
  });

  it('allows the same incompatibility under an adequate minor bump', async () => {
    const injected = dependencies({
      smocket: [{ shape: 'Socket.emit', reason: 'call signature changed incompatibly' }],
    });
    await expect(
      executePublishedTypeCheck({
        changes: changes('0.5.0', '0.6.0'),
        candidate: {
          version: '0.6.0',
          rootTarball: 'candidate-smocket.tgz',
          clientTarball: 'candidate-smocket-client.tgz',
        },
        registry: 'https://registry.npmjs.org/',
        ...injected,
      }),
    ).resolves.toEqual({ checked: ['smocket', 'smocket-client'], skipped: [] });
  });

  it('reports an unpublished package without skipping a published sibling', async () => {
    const injected = dependencies({});
    injected.listVersions.mockImplementation(async (packageName: string) =>
      packageName === 'smocket' ? ['0.5.0'] : [],
    );
    await expect(
      executePublishedTypeCheck({
        changes: changes('0.5.0', '0.5.1'),
        candidate: {
          version: '0.5.1',
          rootTarball: 'candidate-smocket.tgz',
          clientTarball: 'candidate-smocket-client.tgz',
        },
        registry: 'https://registry.npmjs.org/',
        ...injected,
      }),
    ).resolves.toEqual({ checked: ['smocket'], skipped: ['smocket-client'] });
    expect(injected.inspectComparison).toHaveBeenCalledOnce();
  });
});
