// Detect references to external modules in a built bundle.
//
// The check is a tripwire over tsup's output, not a general JavaScript linter:
// the bundle should contain zero module references, so the job is to catch the
// forms tsup emits for an external dependency and no more. Three shapes cover
// them: `require(...)` and dynamic `import(...)` calls, `... from "..."` (static
// import and re-export), and side-effect `import "..."`.
//
// The leading `(?<![.\w$])` is what keeps a method call named `import` or
// `require` (`loader.import("x")`, `registry.require("x")`) from reading as a
// module reference, and the whitespace before the `from`/`import` specifier is
// what keeps `Array.from("x")` out. Matches inside a string literal or comment
// are not filtered: tsup does not emit them for this source, and a false match
// would fail loudly with the file and specifier printed rather than hide.

const PATTERNS = [
  /(?<![.\w$])(?:require|import)\s*\(\s*(['"])([^'"]+)\1/g,
  /(?<![.\w$])from\s+(['"])([^'"]+)\1/g,
  /(?<![.\w$])import\s+(['"])([^'"]+)\1/g,
];

export function detectExternalImports(source) {
  const specifiers = [];
  for (const pattern of PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[2]);
    }
  }
  return specifiers;
}
