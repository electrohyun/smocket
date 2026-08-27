import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-shared-worker-dist-gate-'));
const temporaryDist = join(temporaryRoot, 'dist');

try {
  await cp(resolve(ROOT, 'dist'), temporaryDist, { recursive: true });
  await rm(join(temporaryDist, 'shared-worker.js'));
  const result = spawnSync(
    process.execPath,
    [
      resolve(ROOT, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--config',
      resolve(ROOT, 'vitest.dist.config.ts'),
      'test/shared-worker/host.test.ts',
      'test/shared-worker/client.test.ts',
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, SMOCKET_DIST_DIR: temporaryDist },
    },
  );
  assert.notEqual(
    result.status,
    0,
    `SharedWorker dist tests passed without dist/shared-worker.js\n${result.stdout}${result.stderr}`,
  );
  assert.match(
    `${result.stdout}${result.stderr}`,
    /Cannot find module '(?:\.\/|\.\.\/\.\.\/src\/)shared-worker'/,
    'SharedWorker dist tests failed for an unrelated reason',
  );
  process.stdout.write('SharedWorker dist gate rejected a missing public artifact.\n');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
