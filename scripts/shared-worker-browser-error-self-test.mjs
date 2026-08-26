import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserErrorMonitor } from './browser-error-monitor.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const RUNNER = resolve(ROOT, 'scripts/shared-worker-lifecycle.mjs');

function run(mode) {
  return spawnSync(process.execPath, [RUNNER, `--browser-error-probe=${mode}`], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });
}

assert.throws(
  () =>
    createBrowserErrorMonitor({
      allowed: [{ type: 'pageerror', message: /partial/ }],
    }),
  /must be anchored with \^ and \$/,
);
assert.throws(
  () =>
    createBrowserErrorMonitor({
      allowed: [{ type: 'pageerror', message: /^exact$/g }],
    }),
  /must not use global or sticky flags/,
);

for (const mode of ['pageerror', 'console-error']) {
  const result = run(mode);
  assert.notEqual(
    result.status,
    0,
    `${mode} unexpectedly passed\n${result.stdout}${result.stderr}`,
  );
  assert.match(
    `${result.stdout}${result.stderr}`,
    /Unexpected browser errors:/,
    `${mode} failed for an unrelated reason`,
  );
}

const allowed = run('allowed-pageerror');
assert.equal(
  allowed.status,
  0,
  `an exactly allowlisted page error did not pass\n${allowed.stdout}${allowed.stderr}`,
);

process.stdout.write('SharedWorker browser error gate rejected unexpected errors.\n');
