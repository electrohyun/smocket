import { describe, expect, it, vi } from 'vitest';
import {
  parsePublishedVerificationOptions,
  sanitizeRegistryResponse,
  verifyRegistryVisibility,
} from './verify-published-release.mjs';

describe('exact published release verification', () => {
  it('requires an exact version and finite retry values', () => {
    expect(() => parsePublishedVerificationOptions([])).toThrow('exact npm version');
    expect(() => parsePublishedVerificationOptions(['--version', '^1.2.3'])).toThrow(
      'exact npm version',
    );
    expect(() =>
      parsePublishedVerificationOptions(['--version', '1.2.3', '--attempts', '0']),
    ).toThrow('out of range');
    expect(() =>
      parsePublishedVerificationOptions(['--version', '1.2.3', '--delay-ms', '-1']),
    ).toThrow('integer');
    expect(() =>
      parsePublishedVerificationOptions(['--version', '1.2.3', '--attempts', '21']),
    ).toThrow('out of range');
    expect(() =>
      parsePublishedVerificationOptions([
        '--version',
        '1.2.3',
        '--registry',
        'https://user:secret@registry.example/',
      ]),
    ).toThrow('must not contain credentials');
    expect(() =>
      parsePublishedVerificationOptions([
        '--version',
        '1.2.3',
        '--registry',
        'https://registry.example/?token=secret',
      ]),
    ).toThrow('query parameters');
  });

  it('accepts both exact package identities without sleeping', async () => {
    const lookup = vi.fn(async (_packageName: string, version: string) => ({
      ok: true,
      version,
      response: `"${version}"`,
    }));
    const sleep = vi.fn();

    await verifyRegistryVisibility({
      version: '1.2.3',
      attempts: 3,
      delayMs: 10,
      lookup,
      sleep,
    });

    expect(lookup.mock.calls.map(([packageName]) => packageName)).toEqual([
      'smocket',
      'smocket-client',
    ]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries only package identities that are not visible yet', async () => {
    const calls = new Map<string, number>();
    const lookup = vi.fn(async (packageName: string, version: string) => {
      const count = (calls.get(packageName) ?? 0) + 1;
      calls.set(packageName, count);
      return packageName === 'smocket-client' && count === 1
        ? { ok: false, response: 'E404 not found' }
        : { ok: true, version, response: `"${version}"` };
    });
    const sleep = vi.fn();

    await verifyRegistryVisibility({
      version: '1.2.3',
      attempts: 3,
      delayMs: 25,
      lookup,
      sleep,
    });

    expect(calls).toEqual(
      new Map([
        ['smocket', 1],
        ['smocket-client', 2],
      ]),
    );
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it('reports every unavailable exact package after bounded exhaustion', async () => {
    const reports: unknown[] = [];
    const lookup = vi.fn(async (packageName: string) => ({
      ok: false,
      response: `${packageName} E404`,
    }));

    await expect(
      verifyRegistryVisibility({
        version: '1.2.3',
        attempts: 2,
        delayMs: 0,
        lookup,
        sleep: vi.fn(),
        report: (entry) => reports.push(entry),
      }),
    ).rejects.toThrow('smocket@1.2.3: smocket E404\nsmocket-client@1.2.3: smocket-client E404');
    expect(lookup).toHaveBeenCalledTimes(4);
    expect(reports).toHaveLength(4);
  });

  it('redacts registry credentials and npm tokens from diagnostics', () => {
    expect(
      sanitizeRegistryResponse(
        'https://user:secret@registry.example/ _authToken=npm_abcdefghijklmnopqrstuvwxyz',
      ),
    ).toBe('https://[credentials]@registry.example/ _authToken=[redacted]');
  });
});
