// Assert the built bundle imports nothing external.
//
// Browser-facing smocket entries bundle to self-contained files. Importing
// nothing is what lets those files run in a browser at all (#105) and keeps
// them from dragging a polyfill into every consumer's build. A `node:` import
// that a bundler shims cleanly would still pass the browser job while doing
// exactly that. The packaging job checks resolution, not contents, so nothing
// but this holds the property. #140 removed the last import (`node:crypto`);
// this keeps it out.
//
// The Node-only ws entry may import Node Buffer under ADR 0044. Every other
// external reference remains a regression. Runs after `pnpm build` (wired into `check:package`). The
// reference-detecting regexes and their fixtures live in
// `detect-external-imports.js` and its test.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { unexpectedImports } from './detect-external-imports.js';

const files = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/shared-worker.js',
  'dist/shared-worker.cjs',
  'dist/ws.js',
  'dist/ws.cjs',
];

function findOffenders() {
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const specifier of unexpectedImports(file, source)) {
      offenders.push({ file, specifier });
    }
  }
  return offenders;
}

function main() {
  const offenders = findOffenders();
  if (offenders.length > 0) {
    const list = offenders.map((o) => `  ${o.file}: ${o.specifier}`).join('\n');
    console.error(
      `The built bundle references unsupported external modules:\n${list}\n\n` +
        'The zero-import property is what lets the bundle run in a browser and keeps\n' +
        "a polyfill out of every consumer's build. If an import is genuinely needed,\n" +
        'that is a design change to raise in an issue, not a check to silence.',
    );
    process.exit(1);
  }
  console.log(`External import policy passed for ${files.join(', ')}.`);
}

// Run only when invoked directly, so a test can import the detector without
// reading dist or exiting the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
