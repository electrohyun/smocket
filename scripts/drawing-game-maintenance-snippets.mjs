import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { assertMaintenanceSnippets } from '../case-studies/drawing-game/maintenance-schema.mjs';
import {
  createMaintenanceSnippetArtifact,
  repositoryRoot,
} from '../case-studies/drawing-game/maintenance-source.mjs';

const execFileAsync = promisify(execFile);
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const artifactPath = resolve(
  scriptRoot,
  '../case-studies/drawing-game/maintenance-snippets.generated.json',
);
const prettierConfig = (await resolveConfig(resolve(repositoryRoot, 'package.json'))) ?? {};
const args = process.argv.slice(2);
const shouldWrite = args.includes('--write');
const shouldCheck = args.includes('--check');
if (
  args.length !== Number(shouldWrite) + Number(shouldCheck) ||
  Number(shouldWrite) + Number(shouldCheck) > 1
) {
  throw new Error('Usage: node scripts/drawing-game-maintenance-snippets.mjs [--write | --check]');
}

const { stdout } = await execFileAsync(
  'git',
  ['log', '-1', '--format=%H', '--', 'examples/drawing-game'],
  { cwd: repositoryRoot },
);
const artifact = await createMaintenanceSnippetArtifact(stdout.trim());
assertMaintenanceSnippets(artifact);
const serialized = await format(JSON.stringify(artifact), {
  ...prettierConfig,
  parser: 'json',
});

if (shouldWrite) {
  await writeFile(artifactPath, serialized);
  console.log(`wrote ${artifactPath}`);
} else if (shouldCheck) {
  const current = await readFile(artifactPath, 'utf8');
  assert.equal(
    current,
    serialized,
    'Maintenance snippets are stale. Regenerate with: pnpm case-study:drawing-game:maintenance:snippets',
  );
  console.log('drawing-game maintenance snippets are current');
} else {
  process.stdout.write(serialized);
}
