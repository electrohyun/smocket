// Assert the built bundle imports nothing external.
//
// smocket bundles to a single self-contained file, and importing nothing is what
// lets that file run in a browser at all (#105) and keeps it from dragging a
// polyfill into every consumer's build. A `node:` import that a bundler shims
// cleanly would still pass the browser job while doing exactly that, and the
// packaging job checks resolution, not contents, so nothing but this holds the
// property. #140 removed the last import (`node:crypto`); this keeps it out.
//
// The bundle should contain zero module references, so any match here is a
// regression. Runs after `pnpm build` (wired into `check:package`). The
// reference-detecting regexes and their fixtures live in
// `detect-external-imports.js` and its test.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { detectExternalImports } from './detect-external-imports.js';

const files = ['dist/index.js', 'dist/index.cjs'];

function findOffenders() {
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const specifier of detectExternalImports(source)) {
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
      `The built bundle references external modules, but it must import nothing:\n${list}\n\n` +
        'The zero-import property is what lets the bundle run in a browser and keeps\n' +
        "a polyfill out of every consumer's build. If an import is genuinely needed,\n" +
        'that is a design change to raise in an issue, not a check to silence.',
    );
    process.exit(1);
  }
  console.log(`No external imports in ${files.join(' or ')}.`);
}

// Run only when invoked directly, so a test can import the detector without
// reading dist or exiting the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
