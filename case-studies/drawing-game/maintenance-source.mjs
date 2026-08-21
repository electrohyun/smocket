import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { MAINTENANCE_FEATURES, MAINTENANCE_FEATURE_IDS } from './maintenance-schema.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const prettierConfig = (await resolveConfig(resolve(repositoryRoot, 'package.json'))) ?? {};

function sha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function normalize(source) {
  return source.replaceAll('\r\n', '\n');
}

function parserFor(sourceFile) {
  return extname(sourceFile) === '.ts' ? 'typescript' : 'babel';
}

async function formattedLines(sourceFile) {
  const path = resolve(repositoryRoot, sourceFile);
  const current = normalize(await readFile(path, 'utf8'));
  const formatted = normalize(
    await format(current, { ...prettierConfig, parser: parserFor(sourceFile) }),
  );
  assert.equal(current, formatted, `${sourceFile} must be formatted before LOC is measured`);
  const lines = current.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function classify(entries) {
  const countedLineNumbers = [];
  const excludedLineNumbers = {
    blank: [],
    snippetMarker: [],
    commentOnly: [],
    formattingOnly: [],
  };
  let insideBlockComment = false;

  for (const { lineNumber, text } of entries) {
    let remaining = text.trim();
    if (!remaining) {
      excludedLineNumbers.blank.push(lineNumber);
      continue;
    }
    if (/^\/\/ \[(?:snippet|maintenance-snippet):(start|end) [a-z0-9-]+\]$/.test(remaining)) {
      excludedLineNumbers.snippetMarker.push(lineNumber);
      continue;
    }
    if (insideBlockComment) {
      const end = remaining.indexOf('*/');
      if (end === -1) {
        excludedLineNumbers.commentOnly.push(lineNumber);
        continue;
      }
      insideBlockComment = false;
      remaining = remaining.slice(end + 2).trim();
      if (!remaining) {
        excludedLineNumbers.commentOnly.push(lineNumber);
        continue;
      }
    }
    if (remaining.startsWith('//')) {
      excludedLineNumbers.commentOnly.push(lineNumber);
      continue;
    }
    if (remaining.startsWith('/*')) {
      const end = remaining.indexOf('*/', 2);
      if (end === -1) insideBlockComment = true;
      const after = end === -1 ? '' : remaining.slice(end + 2).trim();
      if (!after) {
        excludedLineNumbers.commentOnly.push(lineNumber);
        continue;
      }
      remaining = after;
    }
    if (/^[()[\]{};,]+$/.test(remaining)) {
      excludedLineNumbers.formattingOnly.push(lineNumber);
      continue;
    }
    countedLineNumbers.push(lineNumber);
  }

  return { countedLineNumbers, excludedLineNumbers };
}

function trimEntries(entries) {
  const result = [...entries];
  while (result[0]?.text.trim() === '') result.shift();
  while (result.at(-1)?.text.trim() === '') result.pop();
  return result;
}

function createBlock(id, sourceFile, entries, startLine, endLine) {
  const trimmed = trimEntries(entries);
  const code = trimmed.map(({ text }) => text).join('\n');
  const { countedLineNumbers, excludedLineNumbers } = classify(entries);
  return {
    id,
    sourceFile,
    language: extname(sourceFile) === '.ts' ? 'typescript' : 'javascript',
    code,
    sourceSha256: sha256(code),
    sourceRange: { startLine, endLine },
    loc: countedLineNumbers.length,
    countedLineNumbers,
    excludedLineNumbers,
  };
}

export async function extractRegions(sourceFile, markerName) {
  const lines = await formattedLines(sourceFile);
  const marker = new RegExp(`^\\s*// \\[${markerName}:(start|end) ([a-z0-9-]+)\\]\\s*$`);
  const open = [];
  const blocks = new Map();

  for (const [index, text] of lines.entries()) {
    const lineNumber = index + 1;
    const match = marker.exec(text);
    if (match) {
      const [, operation, id] = match;
      if (operation === 'start') {
        assert.equal(blocks.has(id), false, `duplicate marker ${id} in ${sourceFile}`);
        open.push({ id, startLine: lineNumber + 1, entries: [] });
      } else {
        const region = open.pop();
        assert.equal(region?.id, id, `unbalanced marker ${id} in ${sourceFile}`);
        blocks.set(
          id,
          createBlock(id, sourceFile, region.entries, region.startLine, lineNumber - 1),
        );
      }
      continue;
    }
    for (const region of open) region.entries.push({ lineNumber, text });
  }

  assert.equal(open.length, 0, `unclosed marker in ${sourceFile}`);
  return blocks;
}

export async function extractWholeFile(id, sourceFile) {
  const lines = await formattedLines(sourceFile);
  const entries = lines.map((text, index) => ({ lineNumber: index + 1, text }));
  return createBlock(id, sourceFile, entries, 1, lines.length);
}

function mergeBlocks(maps) {
  const merged = new Map();
  for (const blocks of maps) {
    for (const [id, block] of blocks) {
      assert.equal(merged.has(id), false, `duplicate source block ${id}`);
      merged.set(id, block);
    }
  }
  return merged;
}

export async function createMaintenanceSourceModel() {
  const handwrittenFiles = [
    'case-studies/drawing-game/fixtures/handwritten/handwritten-socket.mjs',
    'case-studies/drawing-game/fixtures/handwritten/handwritten-loader.mjs',
    'case-studies/drawing-game/fixtures/handwritten/handwritten-substitution.mjs',
    'case-studies/drawing-game/fixtures/handwritten/bootstrap.mjs',
  ];
  const handwritten = mergeBlocks(
    await Promise.all(
      handwrittenFiles.map((sourceFile) => extractRegions(sourceFile, 'maintenance-snippet')),
    ),
  );
  const goldenFiles = [
    'examples/drawing-game/application.ts',
    'examples/drawing-game/client.ts',
    'examples/drawing-game/scenario.ts',
    'examples/drawing-game/smocket.ts',
    'examples/drawing-game/smocket-loader.mjs',
  ];
  const golden = mergeBlocks(
    await Promise.all(goldenFiles.map((sourceFile) => extractRegions(sourceFile, 'snippet'))),
  );
  const smocketRegistration = await extractWholeFile(
    'smocket-loader-registration',
    'examples/drawing-game/smocket-substitution.mjs',
  );
  const sharedApplication = await Promise.all([
    extractWholeFile('shared-application', 'examples/drawing-game/application.ts'),
    extractWholeFile('shared-client', 'examples/drawing-game/client.ts'),
  ]);

  const handwrittenByFeature = new Map([
    [
      'base-single-client',
      [
        handwritten.get('base-single-client'),
        handwritten.get('base-client-substitution'),
        handwritten.get('base-loader-registration'),
        handwritten.get('base-handwritten-bootstrap'),
      ],
    ],
    ...MAINTENANCE_FEATURE_IDS.slice(1).map((featureId) => [
      featureId,
      [handwritten.get(featureId)],
    ]),
  ]);
  for (const [featureId, blocks] of handwrittenByFeature) {
    assert.ok(blocks.every(Boolean), `missing handwritten source for ${featureId}`);
  }
  const smocketIntegration = [
    golden.get('smocket-bootstrap'),
    golden.get('smocket-client-substitution'),
    smocketRegistration,
  ];
  assert.ok(smocketIntegration.every(Boolean), 'missing canonical Smocket integration source');

  return {
    handwrittenByFeature,
    smocketIntegration,
    golden,
    sharedApplication,
  };
}

export async function createMaintenanceSnippetArtifact(sourceRevision) {
  const model = await createMaintenanceSourceModel();
  const snippets = [];

  for (const feature of MAINTENANCE_FEATURES) {
    for (const block of model.handwrittenByFeature.get(feature.id)) {
      snippets.push({
        ...block,
        id: `handwritten.${feature.id}.${block.id}`,
        featureId: feature.id,
        ownership: 'handwritten-support',
        purpose: feature.socketIoMeaning,
      });
    }
    for (const snippetId of feature.goldenSnippetIds) {
      const block = model.golden.get(snippetId);
      assert.ok(block, `missing golden snippet ${snippetId}`);
      snippets.push({
        ...block,
        id: `shared.${feature.id}.${snippetId}`,
        featureId: feature.id,
        ownership: 'shared-application',
        purpose: `Golden application code used by both targets: ${feature.label}`,
      });
    }
  }

  for (const block of model.smocketIntegration) {
    snippets.push({
      ...block,
      id: `smocket.base-single-client.${block.id}`,
      featureId: 'base-single-client',
      ownership: 'smocket-integration',
      purpose: 'Canonical server bootstrap and socket.io-client package substitution.',
    });
  }

  return {
    schemaVersion: 1,
    caseStudy: 'drawing-game-maintenance-surface',
    sourceRevision,
    regenerateWith: 'pnpm case-study:drawing-game:maintenance:snippets',
    featureIds: MAINTENANCE_FEATURE_IDS,
    snippets,
  };
}
