import { repositoryUrlForMarkdownLink } from './repository-links.mjs';

function rewriteLinks(node, sourceFilePath) {
  if (node.type === 'link' && typeof node.url === 'string') {
    node.url = repositoryUrlForMarkdownLink({ sourceFilePath, url: node.url }) ?? node.url;
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      rewriteLinks(child, sourceFilePath);
    }
  }
}

export default function remarkRepositoryLinks() {
  return (tree, file) => {
    const sourceFilePath = file.path;
    if (sourceFilePath) {
      rewriteLinks(tree, sourceFilePath);
    }
  };
}
