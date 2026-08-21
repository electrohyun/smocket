import { register } from 'node:module';

register(new URL('./smocket-loader.mjs', import.meta.url), import.meta.url);
