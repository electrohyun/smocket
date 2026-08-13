import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
if (basename(packageRoot) !== 'smocket-client') {
  throw new Error(`Refusing to clean unexpected package root: ${packageRoot}`);
}

await rm(resolve(packageRoot, 'dist'), { recursive: true, force: true });
