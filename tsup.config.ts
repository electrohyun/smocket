import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/shared-worker.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
