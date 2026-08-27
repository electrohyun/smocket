import { describe, expect, it } from 'vitest';
import { inspectPublishedReleasePin } from './published-consumer-version.mjs';

describe('published consumer supported-release pin', () => {
  it('accepts an exact version and explicit facade state', () => {
    expect(inspectPublishedReleasePin({ version: '1.2.3', includesClient: true })).toEqual({
      version: '1.2.3',
      includesClient: true,
    });
  });

  it('rejects ranges and an omitted facade state', () => {
    expect(() => inspectPublishedReleasePin({ version: '^1.2.3', includesClient: true })).toThrow(
      'exact',
    );
    expect(() => inspectPublishedReleasePin({ version: '1.2.3' })).toThrow(
      'whether smocket-client is included',
    );
  });
});
