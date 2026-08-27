import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const stylesheet = await readFile(new URL('../src/css/custom.css', import.meta.url), 'utf8');

test('lets the documentation gradient span the complete scrollable page', () => {
  assert.match(stylesheet, /#__docusaurus\s*\{[\s\S]*?radial-gradient/u);
  assert.match(stylesheet, /\[data-theme='dark'\] #__docusaurus\s*\{[\s\S]*?radial-gradient/u);
  assert.doesNotMatch(stylesheet, /background-attachment:\s*fixed/u);
});
