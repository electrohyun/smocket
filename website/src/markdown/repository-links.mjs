import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(moduleDirectory, '../..');
const repositoryRoot = path.resolve(websiteRoot, '..');
const docsRoot = path.join(repositoryRoot, 'docs');
const githubRoot = 'https://github.com/electrohyun/smocket';

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

function splitTarget(url) {
  const suffixIndex = url.search(/[?#]/u);
  return suffixIndex === -1 ? [url, ''] : [url.slice(0, suffixIndex), url.slice(suffixIndex)];
}

function encodeRepositoryPath(repositoryPath) {
  return repositoryPath.split('/').map(encodeURIComponent).join('/');
}

export function repositoryUrlForMarkdownLink({ sourceFilePath, url }) {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(url)) {
    return undefined;
  }

  const [target, suffix] = splitTarget(url);
  const sourcePath = path.isAbsolute(sourceFilePath)
    ? sourceFilePath
    : path.resolve(websiteRoot, sourceFilePath);
  const targetPath = path.resolve(path.dirname(sourcePath), decodeURIComponent(target));

  if (!isInside(repositoryRoot, targetPath) || !existsSync(targetPath)) {
    return undefined;
  }

  const targetIsMarkdown = /\.mdx?$/iu.test(targetPath);
  if (isInside(docsRoot, targetPath) && targetIsMarkdown) {
    return undefined;
  }

  const repositoryPath = path.relative(repositoryRoot, targetPath).split(path.sep).join('/');
  const view = statSync(targetPath).isDirectory() ? 'tree' : 'blob';
  return `${githubRoot}/${view}/main/${encodeRepositoryPath(repositoryPath)}${suffix}`;
}

export function resolveRepositoryMarkdownLink({ sourceFilePath, url }) {
  const replacement = repositoryUrlForMarkdownLink({ sourceFilePath, url });
  if (replacement) {
    return replacement;
  }

  throw new Error(`Broken Markdown link in ${sourceFilePath}: ${url}`);
}
