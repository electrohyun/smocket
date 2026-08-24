import assert from 'node:assert/strict';
import test from 'node:test';

import remarkGithubAdmonitionsToDirectives from 'remark-github-admonitions-to-directives';

const expectedDirectives = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'info',
  WARNING: 'warning',
  CAUTION: 'danger',
};

test('converts every supported GitHub Alert type into a Docusaurus directive', () => {
  for (const [alertType, directiveName] of Object.entries(expectedDirectives)) {
    const tree = {
      type: 'root',
      children: [
        {
          type: 'blockquote',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: `[!${alertType}]\nRead this.` }],
            },
          ],
        },
      ],
    };

    remarkGithubAdmonitionsToDirectives()(tree);

    assert.equal(tree.children[0].type, 'containerDirective');
    assert.equal(tree.children[0].name, directiveName);
    assert.equal(tree.children[0].children[0].children[0].value, 'Read this.');
  }
});

test('preserves code, links, and lists inside a converted Alert', () => {
  const inlineCode = { type: 'inlineCode', value: 'worker.ts' };
  const link = {
    type: 'link',
    url: './shared-worker.md',
    children: [{ type: 'text', value: 'guide' }],
  };
  const list = {
    type: 'list',
    ordered: false,
    children: [
      {
        type: 'listItem',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'Keep the name stable.' }] },
        ],
      },
    ],
  };
  const tree = {
    type: 'root',
    children: [
      {
        type: 'blockquote',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: '[!IMPORTANT]\nUse ' },
              inlineCode,
              { type: 'text', value: ' with the ' },
              link,
              { type: 'text', value: '.' },
            ],
          },
          list,
        ],
      },
    ],
  };

  remarkGithubAdmonitionsToDirectives()(tree);

  const directive = tree.children[0];
  assert.equal(directive.type, 'containerDirective');
  assert.equal(directive.name, 'info');
  assert.equal(directive.children[0].children[1], inlineCode);
  assert.equal(directive.children[0].children[3], link);
  assert.equal(directive.children[1], list);
});
