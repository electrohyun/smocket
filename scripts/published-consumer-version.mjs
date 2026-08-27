import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = dirname(dirname(scriptPath));

export function inspectPublishedReleasePin(pin) {
  if (!exactVersionPattern.test(pin?.version ?? '')) {
    throw new Error('published release must pin an exact version');
  }
  if (typeof pin.includesClient !== 'boolean') {
    throw new Error('published release must state whether smocket-client is included');
  }
  return { version: pin.version, includesClient: pin.includesClient };
}

async function main() {
  const pin = inspectPublishedReleasePin(
    JSON.parse(await readFile(join(repositoryRoot, 'consumers', 'published-release.json'), 'utf8')),
  );
  console.log(`version=${pin.version}`);
  console.log(`includes_client=${pin.includesClient}`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) await main();
