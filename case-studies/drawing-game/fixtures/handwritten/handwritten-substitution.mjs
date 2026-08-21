// [maintenance-snippet:start base-loader-registration]
import { register } from 'node:module';

register(new URL('./handwritten-loader.mjs', import.meta.url), import.meta.url);
// [maintenance-snippet:end base-loader-registration]
