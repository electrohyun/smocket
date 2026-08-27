import { open, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultRoots = [join(repositoryRoot, 'docs'), join(repositoryRoot, 'website', 'static')];
const initialReadBytes = 64;
const maximumFtypBoxBytes = 1024 * 1024;
const heifBrands = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);
const jxlContainerSignature = Buffer.from([
  0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
]);

function ascii(buffer, offset) {
  return buffer.subarray(offset, offset + 4).toString('ascii');
}

function ftypLayout(buffer) {
  if (buffer.length < 12 || ascii(buffer, 4) !== 'ftyp') {
    return undefined;
  }

  const size32 = buffer.readUInt32BE(0);
  if (size32 === 1) {
    if (buffer.length < 24) {
      return undefined;
    }
    const size64 = buffer.readBigUInt64BE(8);
    if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) {
      return undefined;
    }
    return { boxSize: Number(size64), majorBrandOffset: 16, compatibleBrandsOffset: 24 };
  }

  return {
    boxSize: size32 === 0 ? undefined : size32,
    majorBrandOffset: 8,
    compatibleBrandsOffset: 16,
  };
}

export function blockedImageFormat(buffer) {
  if (buffer.length >= 4 && ascii(buffer, 0) === 'icns') {
    return 'ICNS';
  }
  if (
    (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0x0a) ||
    (buffer.length >= jxlContainerSignature.length &&
      buffer.subarray(0, jxlContainerSignature.length).equals(jxlContainerSignature))
  ) {
    return 'JPEG XL';
  }
  const layout = ftypLayout(buffer);
  const boxSize = layout?.boxSize ?? buffer.length;
  if (layout && boxSize >= layout.compatibleBrandsOffset) {
    const boxEnd = Math.min(boxSize, buffer.length);
    const brands = [ascii(buffer, layout.majorBrandOffset)];
    for (let offset = layout.compatibleBrandsOffset; offset + 4 <= boxEnd; offset += 4) {
      brands.push(ascii(buffer, offset));
    }
    if (brands.some((brand) => heifBrands.has(brand))) {
      return 'HEIF';
    }
  }
  return undefined;
}

async function header(path) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(initialReadBytes);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const initial = buffer.subarray(0, bytesRead);
    const layout = ftypLayout(initial);
    if (!layout) {
      return initial;
    }

    const boxSize = layout.boxSize ?? (await handle.stat()).size;
    if (boxSize <= initial.length) {
      return initial;
    }
    if (boxSize > maximumFtypBoxBytes) {
      throw new Error(`ISO BMFF ftyp box exceeds ${maximumFtypBoxBytes} bytes`);
    }

    const complete = Buffer.alloc(boxSize);
    const result = await handle.read(complete, 0, complete.length, 0);
    return complete.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function filesUnder(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export async function findBlockedDocImages(roots = defaultRoots) {
  const blocked = [];
  for (const root of roots) {
    for (const path of await filesUnder(root)) {
      const format = blockedImageFormat(await header(path));
      if (format) {
        blocked.push({ format, path });
      }
    }
  }
  return blocked;
}

async function main() {
  const blocked = await findBlockedDocImages();
  if (blocked.length > 0) {
    const detail = blocked
      .map(
        ({ format, path }) =>
          `- ${format}: ${relative(repositoryRoot, path).replaceAll('\\', '/')}`,
      )
      .join('\n');
    throw new Error(`Unsupported documentation image formats:\n${detail}`);
  }
  console.log('Documentation image formats are safe for the current build toolchain.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
