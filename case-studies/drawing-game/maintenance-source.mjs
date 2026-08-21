import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { HANDWRITTEN_STAGE_DEFINITIONS, HANDWRITTEN_STAGE_IDS } from './maintenance-schema.mjs';

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

function createBlock(id, role, sourceFile, lines) {
  const entries = lines.map((text, index) => ({ lineNumber: index + 1, text }));
  const code = lines.join('\n');
  const { countedLineNumbers, excludedLineNumbers } = classify(entries);
  return {
    id,
    role,
    sourceFile,
    language: extname(sourceFile) === '.ts' ? 'typescript' : 'javascript',
    code,
    sourceSha256: sha256(code),
    sourceRange: { startLine: 1, endLine: lines.length },
    loc: countedLineNumbers.length,
    countedLineNumbers,
    excludedLineNumbers,
  };
}

async function extractWholeFile(id, role, sourceFile) {
  return createBlock(id, role, sourceFile, await formattedLines(sourceFile));
}

async function extractRegions(sourceFile, markerName) {
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
        assert.equal(
          open.some((region) => region.id === id),
          false,
          `re-entered marker ${id} in ${sourceFile}`,
        );
        open.push({ id, startLine: lineNumber + 1, entries: [] });
      } else {
        const region = open.pop();
        assert.equal(region?.id, id, `unbalanced marker ${id} in ${sourceFile}`);
        const regionLines = region.entries.map(({ text: entry }) => entry);
        const block = createBlock(id, id, sourceFile, regionLines);
        block.sourceRange = { startLine: region.startLine, endLine: lineNumber - 1 };
        block.countedLineNumbers = block.countedLineNumbers.map(
          (relativeLine) => relativeLine + region.startLine - 1,
        );
        for (const values of Object.values(block.excludedLineNumbers)) {
          for (let offset = 0; offset < values.length; offset += 1) {
            values[offset] += region.startLine - 1;
          }
        }
        blocks.set(id, block);
      }
      continue;
    }
    for (const region of open) region.entries.push({ lineNumber, text });
  }
  assert.equal(open.length, 0, `unclosed marker in ${sourceFile}`);
  return blocks;
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

function countedCodeLines(block) {
  const lines = block.code.split('\n');
  const startLine = block.sourceRange.startLine;
  return block.countedLineNumbers.map((lineNumber) => lines[lineNumber - startLine]);
}

function diffOperations(before, after) {
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      table[left][right] =
        before[left] === after[right]
          ? table[left + 1][right + 1] + 1
          : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }

  const operations = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && right < after.length && before[left] === after[right]) {
      operations.push({ prefix: ' ', line: before[left] });
      left += 1;
      right += 1;
    } else if (
      left < before.length &&
      (right === after.length || table[left + 1][right] >= table[left][right + 1])
    ) {
      operations.push({ prefix: '-', line: before[left] });
      left += 1;
    } else {
      operations.push({ prefix: '+', line: after[right] });
      right += 1;
    }
  }
  return operations;
}

function createDiffBlock(role, previousBlock, currentBlock) {
  const previousSourceFile = previousBlock?.sourceFile ?? '/dev/null';
  const currentSourceFile = currentBlock?.sourceFile ?? '/dev/null';
  const operations = diffOperations(
    previousBlock ? countedCodeLines(previousBlock) : [],
    currentBlock ? countedCodeLines(currentBlock) : [],
  );
  const additions = operations.filter(({ prefix }) => prefix === '+').length;
  const deletions = operations.filter(({ prefix }) => prefix === '-').length;
  const code = [
    `--- ${previousSourceFile}`,
    `+++ ${currentSourceFile}`,
    '@@ counted LOC @@',
    ...operations.map(({ prefix, line }) => `${prefix}${line}`),
  ].join('\n');
  return {
    id: `diff-${role}`,
    role,
    previousSourceFile,
    currentSourceFile,
    language: 'diff',
    code,
    sourceSha256: sha256(code),
    additions,
    deletions,
  };
}

function createStageDiff(previousBlocks, currentBlocks) {
  const previousByRole = new Map(previousBlocks.map((block) => [block.role, block]));
  const currentByRole = new Map(currentBlocks.map((block) => [block.role, block]));
  const roles = [...new Set([...previousByRole.keys(), ...currentByRole.keys()])];
  return roles.map((role) =>
    createDiffBlock(role, previousByRole.get(role), currentByRole.get(role)),
  );
}

function stageSourceHash(blocks) {
  return sha256(
    blocks
      .map(({ role, sourceFile, sourceSha256 }) => `${role}\0${sourceFile}\0${sourceSha256}`)
      .join('\n'),
  );
}

export async function createMaintenanceSourceModel() {
  const stages = [];
  let previousBlocks = [];
  for (const definition of HANDWRITTEN_STAGE_DEFINITIONS) {
    const sourceBlocks = await Promise.all(
      definition.sources.map(({ role, sourceFile }) =>
        extractWholeFile(`${definition.id}-${role}`, role, sourceFile),
      ),
    );
    const diffBlocks = createStageDiff(previousBlocks, sourceBlocks);
    const additions = diffBlocks.reduce((sum, block) => sum + block.additions, 0);
    const deletions = diffBlocks.reduce((sum, block) => sum + block.deletions, 0);
    stages.push({
      ...definition,
      sourceFiles: sourceBlocks.map(({ sourceFile }) => sourceFile),
      sourceBlocks,
      sourceHash: stageSourceHash(sourceBlocks),
      totalLoc: sourceBlocks.reduce((sum, block) => sum + block.loc, 0),
      change: { additions, deletions, net: additions - deletions },
      diffBlocks,
    });
    previousBlocks = sourceBlocks;
  }

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
  const smocketIntegration = [
    golden.get('smocket-bootstrap'),
    golden.get('smocket-client-substitution'),
    await extractWholeFile(
      'smocket-loader-registration',
      'loader-registration',
      'examples/drawing-game/smocket-substitution.mjs',
    ),
  ];
  assert.ok(smocketIntegration.every(Boolean), 'missing canonical Smocket integration source');
  const sharedApplication = await Promise.all([
    extractWholeFile('shared-application', 'application', 'examples/drawing-game/application.ts'),
    extractWholeFile('shared-client', 'client', 'examples/drawing-game/client.ts'),
  ]);

  return { stages, smocketIntegration, sharedApplication, golden, goldenFiles };
}

export async function createMaintenanceSnippetArtifact(sourceRevision) {
  const model = await createMaintenanceSourceModel();
  const snippets = [];
  for (const stage of model.stages) {
    for (const block of stage.sourceBlocks) {
      snippets.push({
        ...block,
        id: `handwritten.${stage.id}.source.${block.role}`,
        owner: 'handwritten',
        kind: 'source',
        stageId: stage.id,
        purpose: stage.label,
      });
    }
    for (const block of stage.diffBlocks) {
      snippets.push({
        ...block,
        id: `handwritten.${stage.id}.diff.${block.role}`,
        owner: 'handwritten',
        kind: 'diff',
        stageId: stage.id,
        purpose: `Counted source change from ${stage.prerequisite ?? 'an empty implementation'}.`,
      });
    }
  }
  for (const block of model.smocketIntegration) {
    snippets.push({
      ...block,
      id: `smocket.integration.${block.id}`,
      owner: 'smocket',
      kind: 'source',
      purpose: 'Canonical Smocket bootstrap or client substitution used by the golden workflow.',
    });
  }
  return {
    schemaVersion: 2,
    caseStudy: 'drawing-game-maintenance-surface',
    sourceRevision,
    stageIds: HANDWRITTEN_STAGE_IDS,
    regeneration: 'pnpm case-study:drawing-game:maintenance:snippets',
    snippets,
  };
}
