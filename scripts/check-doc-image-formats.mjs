import { open, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultRoots = [join(repositoryRoot, 'docs'), join(repositoryRoot, 'website', 'static')];
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
  if (buffer.length >= 12 && ascii(buffer, 4) === 'ftyp') {
    const brands = [ascii(buffer, 8)];
    for (let offset = 16; offset + 4 <= buffer.length; offset += 4) {
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
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
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
