import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  assertPublicationArtifact,
  createPublicationArtifact,
  loadPublicationInputs,
} from '../case-studies/drawing-game/publication-schema.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prettierConfig = (await resolveConfig(resolve(repositoryRoot, 'package.json'))) ?? {};
const artifactPath = resolve(
  repositoryRoot,
  'case-studies/drawing-game/publication.generated.json',
);
const args = process.argv.slice(2);

assert.ok(
  args.length === 1 && ['--write', '--check', '--validate'].includes(args[0]),
  'Usage: node scripts/drawing-game-publication.mjs <--write|--check|--validate>',
);

const inputs = await loadPublicationInputs(repositoryRoot);
const generated = createPublicationArtifact(inputs);
const serialized = await format(JSON.stringify(generated), {
  ...prettierConfig,
  parser: 'json',
});

if (args[0] === '--write') {
  await writeFile(artifactPath, serialized);
  console.log(`Wrote ${artifactPath}`);
} else if (args[0] === '--check') {
  const current = await readFile(artifactPath, 'utf8');
  assert.equal(
    current,
    serialized,
    'Drawing-game publication artifact is stale. Regenerate with: pnpm case-study:drawing-game:publication:record',
  );
  console.log('Drawing-game publication artifact is current.');
} else {
  const current = JSON.parse(await readFile(artifactPath, 'utf8'));
  assertPublicationArtifact(current, inputs);
  console.log('Drawing-game publication schema and cross-references are valid.');
}
