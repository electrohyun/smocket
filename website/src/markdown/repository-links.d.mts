export interface MarkdownLinkContext {
  sourceFilePath: string;
  url: string;
}

export function repositoryUrlForMarkdownLink(context: MarkdownLinkContext): string | undefined;
export function resolveRepositoryMarkdownLink(context: MarkdownLinkContext): string;
