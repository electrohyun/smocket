import assert from 'node:assert/strict';
import test from 'node:test';

import {
  repositoryUrlForMarkdownLink,
  resolveRepositoryMarkdownLink,
} from '../src/markdown/repository-links.mjs';
import remarkRepositoryLinks from '../src/markdown/remark-repository-links.mjs';

test('keeps links between documentation files in the docs plugin', () => {
  assert.equal(
    repositoryUrlForMarkdownLink({
      sourceFilePath: '../docs/README.md',
      url: './shared-worker.md',
    }),
    undefined,
  );
});

test('rewrites repository files and preserves line anchors', () => {
  assert.equal(
    repositoryUrlForMarkdownLink({
      sourceFilePath: '../docs/troubleshooting.md',
      url: '../src/connect-url.test.ts#L14',
    }),
    'https://github.com/electrohyun/smocket/blob/main/src/connect-url.test.ts#L14',
  );
});

test('rewrites repository directories with tree links', () => {
  assert.equal(
    repositoryUrlForMarkdownLink({
      sourceFilePath: '../docs/README.md',
      url: '../examples/chat-room/',
    }),
    'https://github.com/electrohyun/smocket/tree/main/examples/chat-room',
  );
});

test('rejects missing repository targets instead of hiding broken links', () => {
  assert.throws(
    () =>
      resolveRepositoryMarkdownLink({
        sourceFilePath: '../docs/README.md',
        url: '../missing-example/',
      }),
    /Broken Markdown link/u,
  );
});

test('remark rewrites repository assets before Docusaurus bundles them', () => {
  const tree = {
    type: 'root',
    children: [
      { type: 'link', url: '../case-studies/drawing-game/evaluate.mjs', children: [] },
      {
        type: 'definition',
        identifier: 'source',
        url: '../src/connect-url.test.ts',
      },
      { type: 'link', url: './scope.md', children: [] },
      { type: 'mdxTextExpression', value: ' auth ', data: {} },
    ],
  };

  remarkRepositoryLinks()(tree, {
    path: '../docs/README.md',
  });

  assert.equal(
    tree.children[0].url,
    'https://github.com/electrohyun/smocket/blob/main/case-studies/drawing-game/evaluate.mjs',
  );
  assert.equal(
    tree.children[1].url,
    'https://github.com/electrohyun/smocket/blob/main/src/connect-url.test.ts',
  );
  assert.equal(tree.children[2].url, './scope.md');
  assert.deepEqual(tree.children[3], { type: 'text', value: '{ auth }' });
});
