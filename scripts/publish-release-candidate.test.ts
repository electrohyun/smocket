import { describe, expect, it, vi } from 'vitest';
import {
  executePublication,
  parsePublicationOptions,
  publicationPlan,
} from './publish-release-candidate.mjs';

const candidate = {
  manifestPath: '/candidate/release-candidate.json',
  version: '1.2.3',
  rootTarball: '/candidate/smocket-1.2.3.tgz',
  clientTarball: '/candidate/smocket-client-1.2.3.tgz',
};

describe('release candidate publication', () => {
  it('accepts exact verify and publish requests', () => {
    expect(
      parsePublicationOptions(['verify', '--manifest', 'candidate.json', '--version', '1.2.3']),
    ).toMatchObject({ command: 'verify', version: '1.2.3', packageName: undefined });

    expect(
      parsePublicationOptions([
        'publish',
        '--manifest',
        'candidate.json',
        '--version',
        '1.2.3',
        '--package',
        'smocket-client',
      ]),
    ).toMatchObject({
      command: 'publish',
      version: '1.2.3',
      packageName: 'smocket-client',
      registry: 'https://registry.npmjs.org/',
    });
  });

  it('rejects ambiguous versions, packages, and registries', () => {
    expect(() =>
      parsePublicationOptions([
        'publish',
        '--manifest',
        'candidate.json',
        '--version',
        '^1.2.3',
        '--package',
        'smocket',
      ]),
    ).toThrow('exact npm version');
    expect(() =>
      parsePublicationOptions([
        'publish',
        '--manifest',
        'candidate.json',
        '--version',
        '1.2.3',
        '--package',
        'other',
      ]),
    ).toThrow('released package');
    expect(() =>
      parsePublicationOptions([
        'verify',
        '--manifest',
        'candidate.json',
        '--version',
        '1.2.3',
        '--registry',
        'http://registry.example.test/',
      ]),
    ).toThrow('HTTPS');
  });

  it('publishes only the exact tarball selected from the verified candidate', async () => {
    const loadCandidate = vi.fn(async () => candidate);
    const run = vi.fn(async () => {});
    const options = parsePublicationOptions([
      'publish',
      '--manifest',
      'candidate.json',
      '--version',
      '1.2.3',
      '--package',
      'smocket-client',
    ]);

    await expect(executePublication(options, { loadCandidate, run })).resolves.toEqual({
      version: '1.2.3',
      published: 'smocket-client',
    });
    expect(loadCandidate).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('npm', [
      'publish',
      candidate.clientTarball,
      '--ignore-scripts',
      '--registry',
      'https://registry.npmjs.org/',
    ]);
  });

  it('stops before npm when the requested and candidate versions differ', async () => {
    const run = vi.fn(async () => {});
    const options = parsePublicationOptions([
      'publish',
      '--manifest',
      'candidate.json',
      '--version',
      '1.2.4',
      '--package',
      'smocket',
    ]);

    await expect(
      executePublication(options, { loadCandidate: async () => candidate, run }),
    ).rejects.toThrow('requested version must match');
    expect(run).not.toHaveBeenCalled();
  });

  it('maps each package to its manifest-owned tarball', () => {
    expect(publicationPlan(candidate, 'smocket', 'https://registry.npmjs.org/').arguments[1]).toBe(
      candidate.rootTarball,
    );
    expect(
      publicationPlan(candidate, 'smocket-client', 'https://registry.npmjs.org/').arguments[1],
    ).toBe(candidate.clientTarball);
  });
});
