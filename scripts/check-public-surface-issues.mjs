import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const issueReference = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;

export function trackedIssueReferences(entries) {
  return [
    ...new Map(
      entries
        .filter(({ disposition }) => disposition === 'tracked-issue')
        .map(({ reference }) => {
          const match = issueReference.exec(reference);
          if (!match) throw new Error(`Invalid tracked issue reference: ${reference}`);
          const [, owner, repository, number] = match;
          return [reference, { number: Number(number), owner, reference, repository }];
        }),
    ).values(),
  ];
}

export async function findClosedTrackedIssues(entries, loadIssue) {
  const closed = [];
  for (const issue of trackedIssueReferences(entries)) {
    const state = await loadIssue(issue);
    if (state !== 'open') closed.push({ ...issue, state });
  }
  return closed;
}

async function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const ledger = JSON.parse(
    await readFile(resolve(root, 'docs', 'public-surface-ledger.json'), 'utf8'),
  );
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const closed = await findClosedTrackedIssues(ledger.entries, async (issue) => {
    const response = await fetch(
      `https://api.github.com/repos/${issue.owner}/${issue.repository}/issues/${issue.number}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'User-Agent': 'smocket-public-surface-check',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub issue lookup failed for ${issue.reference}: ${response.status}`);
    }
    const result = await response.json();
    return result.state;
  });
  if (closed.length === 0) return;
  throw new Error(
    `Tracked public-surface issues must remain open:\n${closed
      .map(({ reference, state }) => `- ${reference} is ${state}`)
      .join('\n')}`,
  );
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
