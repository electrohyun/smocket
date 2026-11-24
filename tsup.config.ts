import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/shared-worker.ts', 'src/ws.ts'],
  format: ['esm', 'cjs'],
  splitting: false,
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
