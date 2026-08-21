import * as nodeModule from 'node:module';

if (typeof nodeModule.register !== 'function') {
  throw new Error('The drawing-game handwritten maintenance flow requires Node.js >=20.6.0.');
}

nodeModule.register(new URL('./handwritten-loader.mjs', import.meta.url), import.meta.url);
