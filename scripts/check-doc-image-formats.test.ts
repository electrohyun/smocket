import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockedImageFormat, findBlockedDocImages } from './check-doc-image-formats.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('documentation image format gate', () => {
  it.each([
    ['ICNS', Buffer.from('icns0000', 'ascii')],
    ['JPEG XL codestream', Buffer.from([0xff, 0x0a, 0x00, 0x00])],
    [
      'JPEG XL container',
      Buffer.from([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
    ],
    ['HEIF major brand', Buffer.from('0000ftypheic0000', 'ascii')],
    ['HEIF compatible brand', Buffer.from('0000ftypisom0000mif1', 'ascii')],
  ])('recognizes %s content', (_name, payload) => {
    expect(blockedImageFormat(payload)).toBeDefined();
  });

  it('accepts the supported PNG signature', () => {
    expect(blockedImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      undefined,
    );
  });

  it('rejects blocked content even when its extension is renamed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'smocket-doc-images-'));
    temporaryRoots.push(root);
    const nested = join(root, 'nested');
    await mkdir(nested);
    const path = join(nested, 'renamed.png');
    await writeFile(path, Buffer.from('icns0000', 'ascii'));

    await expect(findBlockedDocImages([root])).resolves.toEqual([{ format: 'ICNS', path }]);
  });
});
