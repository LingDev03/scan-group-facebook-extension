import type { ScrapedPost } from './types';

function escapeCsv(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function postsToJson(posts: ScrapedPost[]): string {
  return JSON.stringify(posts, null, 2);
}

export function postsToCsv(posts: ScrapedPost[]): string {
  const header = 'group,rule,date,author,keywords,text,link';
  const rows = posts.map((p) =>
    [
      escapeCsv(p.groupName),
      escapeCsv(p.matchedRuleName ?? ''),
      escapeCsv(p.createdAt),
      escapeCsv(p.author),
      escapeCsv(p.matchedKeywords.join('; ')),
      escapeCsv(p.text),
      escapeCsv(p.permalink),
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

export async function downloadPosts(
  posts: ScrapedPost[],
  format: 'json' | 'csv',
  groupLabel: string,
): Promise<void> {
  const content = format === 'json' ? postsToJson(posts) : postsToCsv(posts);
  const mime = format === 'json' ? 'application/json' : 'text/csv';
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeGroup = groupLabel.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
  const filename = `fb-scan-${safeGroup}-${timestamp}.${format}`;

  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
