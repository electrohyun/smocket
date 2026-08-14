import { describe, expect, it } from 'vitest';
import { inspectPublishedConsumerPin } from './published-consumer-version.mjs';

type LockedPackage = {
  dependencies?: Record<string, string>;
  version?: string;
  resolved?: string;
  peerDependencies?: Record<string, string>;
};

function rootFixture(version = '1.2.3'): {
  manifest: { dependencies: Record<string, string> };
  lockfile: { packages: Record<string, LockedPackage> };
} {
  return {
    manifest: { dependencies: { smocket: version } },
    lockfile: {
      packages: {
        '': { dependencies: { smocket: version } },
        'node_modules/smocket': {
          version,
          resolved: `https://registry.npmjs.org/smocket/-/smocket-${version}.tgz`,
        },
      },
    },
  };
}

describe('published consumer supported-release pin', () => {
  it('accepts one exact root pin across the manifest and lockfile', () => {
    const fixture = rootFixture();
    expect(inspectPublishedConsumerPin(fixture.manifest, fixture.lockfile)).toEqual({
      version: '1.2.3',
      includesClient: false,
    });
  });

  it('rejects ranges, lock drift, and non-registry resolution', () => {
    const range = rootFixture('^1.2.3');
    expect(() => inspectPublishedConsumerPin(range.manifest, range.lockfile)).toThrow('exact');

    const drift = rootFixture();
    drift.lockfile.packages[''].dependencies.smocket = '1.2.2';
    expect(() => inspectPublishedConsumerPin(drift.manifest, drift.lockfile)).toThrow('must match');

    const local = rootFixture();
    local.lockfile.packages['node_modules/smocket'].resolved = 'file:../../smocket.tgz';
    expect(() => inspectPublishedConsumerPin(local.manifest, local.lockfile)).toThrow(
      'canonical npm registry',
    );
  });

  it('accepts only a synchronized facade pin with its exact root peer', () => {
    const fixture = rootFixture();
    fixture.manifest.dependencies['smocket-client'] = '1.2.3';
    fixture.lockfile.packages[''].dependencies['smocket-client'] = '1.2.3';
    fixture.lockfile.packages['node_modules/smocket-client'] = {
      version: '1.2.3',
      resolved: 'https://registry.npmjs.org/smocket-client/-/smocket-client-1.2.3.tgz',
      peerDependencies: { smocket: '1.2.3' },
    };

    expect(inspectPublishedConsumerPin(fixture.manifest, fixture.lockfile)).toEqual({
      version: '1.2.3',
      includesClient: true,
    });

    fixture.lockfile.packages['node_modules/smocket-client'].peerDependencies.smocket = '^1.2.3';
    expect(() => inspectPublishedConsumerPin(fixture.manifest, fixture.lockfile)).toThrow(
      'exact root peer',
    );
  });
});
