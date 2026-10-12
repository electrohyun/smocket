import ts from 'typescript';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => resolve(root, 'scripts/fixtures/ws-types', name);

const cases = [
  {
    name: 'without Node types',
    files: ['usage.ts'],
    types: [],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  },
  {
    name: 'with Node Buffer',
    files: ['usage.ts', 'node-buffer.ts'],
    types: ['node'],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  },
];

for (const scenario of cases) {
  const program = ts.createProgram({
    rootNames: scenario.files.map(fixture),
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      lib: scenario.lib,
      types: scenario.types,
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noUncheckedIndexedAccess: true,
    },
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);

  if (diagnostics.length) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (file) => file,
        getNewLine: () => '\n',
      }),
    );

    process.exitCode = 1;
  } else console.log(`ws contract ${scenario.name}: passed (TypeScript ${ts.version})`);
}
