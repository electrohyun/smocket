import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blockedImageFormat, findBlockedDocImages } from './check-doc-image-formats.mjs';

const temporaryRoots: string[] = [];

function ftypBox(majorBrand: string, compatibleBrands: string[]) {
  const box = Buffer.alloc(16 + compatibleBrands.length * 4);
  box.writeUInt32BE(box.length, 0);
  box.write('ftyp', 4, 'ascii');
  box.write(majorBrand, 8, 'ascii');
  for (const [index, brand] of compatibleBrands.entries()) {
    box.write(brand, 16 + index * 4, 'ascii');
  }
  return box;
}

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
    ['HEIF major brand', ftypBox('heic', [])],
    ['HEIF compatible brand', ftypBox('isom', ['mif1'])],
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

  it('reads a declared ftyp box far enough to find a compatible brand after byte 64', async () => {
    const root = await mkdtemp(join(tmpdir(), 'smocket-doc-images-'));
    temporaryRoots.push(root);
    const path = join(root, 'late-brand.png');
    await writeFile(path, ftypBox('isom', [...Array(13).fill('isom'), 'heic']));

    await expect(findBlockedDocImages([root])).resolves.toEqual([{ format: 'HEIF', path }]);
  });
});
