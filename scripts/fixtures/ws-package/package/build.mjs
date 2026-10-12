import { pathToFileURL } from 'node:url';

const { build } = await import(pathToFileURL(process.argv[2]).href);

await build({
  config: false,
  entry: { ws: 'src/entry.ts' },
  format: ['esm', 'cjs'],
  splitting: false,
  dts: true,
  clean: true,
  sourcemap: false,
  treeshake: true,
  silent: true,
});
