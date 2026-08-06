import { expect, it } from 'vitest';

import { detectExternalImports } from './detect-external-imports.js';

// The forms tsup emits for an external dependency, which the check must catch.
it.each([
  ['require call', 'const c = require("node:crypto");', 'node:crypto'],
  ['dynamic import', 'const m = import("lodash");', 'lodash'],
  ['re-export from', 'export { Server } from "socket.io";', 'socket.io'],
  ['static import from', 'import { io } from "socket.io-client";', 'socket.io-client'],
  ['side-effect import', 'import "./register-globals";', './register-globals'],
])('flags a %s', (_shape, source, specifier) => {
  expect(detectExternalImports(source)).toContain(specifier);
});

// Shapes that read like a module reference but are not one. A method named
// `import`/`require`, and the member calls whose name ends in `from`, must not
// trip the check.
it.each([
  ['import method call', 'loader.import("./plugin");'],
  ['require method call', 'registry.require("./plugin");'],
  ['Array.from', 'Array.from("abc");'],
  ['Buffer.from', 'Buffer.from("x", "utf8");'],
  ['String.fromCharCode', 'String.fromCharCode(65);'],
])('ignores %s', (_shape, source) => {
  expect(detectExternalImports(source)).toEqual([]);
});

// The real bundle imports nothing, so the empty case is the steady state.
it('finds nothing in source without references', () => {
  expect(detectExternalImports('function defer(fn) { queueMicrotask(fn); }')).toEqual([]);
});
