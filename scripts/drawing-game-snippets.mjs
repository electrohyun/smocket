import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactPath = resolve(root, 'examples/drawing-game/snippets.generated.json');
const regenerateWith = 'pnpm example:drawing-game:snippets';

const definitions = [
  ['room-join', 'examples/drawing-game/application.ts', 'Join and acknowledge the shared room.'],
  [
    'drawing-server-handler',
    'examples/drawing-game/application.ts',
    'Exclude the drawer while broadcasting a stroke to the room.',
  ],
  [
    'drawing-client',
    'examples/drawing-game/client.ts',
    'Send stroke segments and receive the segments delivered by the server.',
  ],
  [
    'chat-guess-server-handler',
    'examples/drawing-game/application.ts',
    'Handle chat and guesses, including acknowledgements and winner delivery.',
  ],
  [
    'chat-guess-client',
    'examples/drawing-game/client.ts',
    'Submit guesses and receive chat, targeted correct, and room announce events.',
  ],
  [
    'acknowledgement',
    'examples/drawing-game/application.ts',
    'Return the server-side boolean guess acknowledgement.',
  ],
  [
    'targeted-correct',
    'examples/drawing-game/application.ts',
    'Emit the correct result only to the winning socket id.',
  ],
  [
    'room-announce',
    'examples/drawing-game/application.ts',
    'Announce the winner and word to every connected room member.',
  ],
  [
    'disconnect-behavior',
    'examples/drawing-game/scenario.ts',
    'Disconnect C, wait for server cleanup, and prove the next stroke reaches only B.',
  ],
  [
    'real-bootstrap',
    'examples/drawing-game/real.ts',
    'Start Real Socket.IO on an ephemeral Node HTTP port and register the golden handlers.',
  ],
  [
    'smocket-bootstrap',
    'examples/drawing-game/smocket.ts',
    'Start an isolated in-memory Smocket server and register the golden handlers.',
  ],
  [
    'smocket-client-substitution',
    'examples/drawing-game/smocket-loader.mjs',
    'Resolve socket.io-client to smocket-client only for the compiled Smocket target.',
  ],
];

const marker = /^\s*\/\/ \[snippet:(start|end) ([a-z0-9-]+)\]\s*$/;

function trimBlankLines(lines) {
  while (lines[0]?.trim() === '') lines.shift();
  while (lines.at(-1)?.trim() === '') lines.pop();
  return lines;
}

async function extractFile(sourceFile, expectedIds) {
  const source = await readFile(resolve(root, sourceFile), 'utf8');
  const snippets = new Map(expectedIds.map((id) => [id, []]));
  const open = [];
  const seen = new Set();

  for (const line of source.replaceAll('\r\n', '\n').split('\n')) {
    const match = marker.exec(line);
    if (match) {
      const [, operation, id] = match;
      if (!snippets.has(id)) throw new Error(`Unknown snippet marker ${id} in ${sourceFile}`);
      if (operation === 'start') {
        if (seen.has(id)) throw new Error(`Duplicate snippet ${id} in ${sourceFile}`);
        seen.add(id);
        open.push(id);
      } else if (open.pop() !== id) {
        throw new Error(`Unbalanced snippet ${id} in ${sourceFile}`);
      }
      continue;
    }

    for (const id of open) snippets.get(id).push(line);
  }

  if (open.length > 0) throw new Error(`Unclosed snippet ${open.at(-1)} in ${sourceFile}`);
  for (const id of expectedIds) {
    if (!seen.has(id)) throw new Error(`Missing snippet ${id} in ${sourceFile}`);
  }
  return snippets;
}

async function generate() {
  const grouped = new Map();
  for (const definition of definitions) {
    const sourceFile = definition[1];
    const entries = grouped.get(sourceFile) ?? [];
    entries.push(definition);
    grouped.set(sourceFile, entries);
  }
  const extracted = new Map();

  for (const [sourceFile, entries] of grouped) {
    const snippets = await extractFile(
      sourceFile,
      entries.map(([id]) => id),
    );
    for (const [id, lines] of snippets) extracted.set(id, trimBlankLines(lines).join('\n'));
  }

  return {
    schemaVersion: 1,
    regenerateWith,
    snippets: definitions.map(([id, sourceFile, purpose]) => ({
      id,
      sourceFile,
      language: sourceFile.endsWith('.ts') ? 'typescript' : 'javascript',
      purpose,
      code: extracted.get(id),
    })),
  };
}

const serialized = `${JSON.stringify(await generate(), null, 2)}\n`;

if (process.argv.includes('--write')) {
  await writeFile(artifactPath, serialized);
  console.log(`Wrote ${artifactPath}`);
} else if (process.argv.includes('--check')) {
  const current = await readFile(artifactPath, 'utf8');
  if (current !== serialized) {
    throw new Error(`Snippet artifact is stale. Regenerate it with: ${regenerateWith}`);
  }
  console.log('Drawing-game snippets are current.');
} else {
  process.stdout.write(serialized);
}
