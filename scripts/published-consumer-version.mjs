import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = dirname(dirname(scriptPath));

export function inspectPublishedConsumerPin(manifest, lockfile) {
  const version = manifest.dependencies?.smocket;
  assert.match(version ?? '', exactVersionPattern, 'published consumer must pin exact smocket');
  assert.equal(
    lockfile.packages?.['']?.dependencies?.smocket,
    version,
    'published consumer root lock dependency must match the manifest pin',
  );

  const lockedRoot = lockfile.packages?.['node_modules/smocket'];
  assert.equal(lockedRoot?.version, version, 'installed smocket lock entry must match the pin');
  assert.equal(
    lockedRoot?.resolved,
    `https://registry.npmjs.org/smocket/-/smocket-${version}.tgz`,
    'smocket lock entry must resolve from the canonical npm registry',
  );

  const clientVersion = manifest.dependencies?.['smocket-client'];
  if (clientVersion === undefined) return { version, includesClient: false };

  assert.equal(clientVersion, version, 'published facade pin must equal the root pin');
  assert.equal(
    lockfile.packages?.['']?.dependencies?.['smocket-client'],
    version,
    'published consumer root lock facade dependency must match the pin',
  );
  const lockedClient = lockfile.packages?.['node_modules/smocket-client'];
  assert.equal(lockedClient?.version, version, 'installed facade lock entry must match the pin');
  assert.equal(
    lockedClient?.peerDependencies?.smocket,
    version,
    'installed facade lock entry must keep the exact root peer',
  );
  assert.equal(
    lockedClient?.resolved,
    `https://registry.npmjs.org/smocket-client/-/smocket-client-${version}.tgz`,
    'facade lock entry must resolve from the canonical npm registry',
  );
  return { version, includesClient: true };
}

async function main() {
  const consumerRoot = join(repositoryRoot, 'consumers', 'chat-room');
  const [manifest, lockfile] = await Promise.all(
    ['package.json', 'package-lock.json'].map(async (file) =>
      JSON.parse(await readFile(join(consumerRoot, file), 'utf8')),
    ),
  );
  const pin = inspectPublishedConsumerPin(manifest, lockfile);
  console.log(`version=${pin.version}`);
  console.log(`includes_client=${pin.includesClient}`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) await main();
