/**
 * export-notes.ts — write captured tweets into the vault as Markdown notes.
 *
 * Frontmatter mirrors the CLI's export_obsidian.mjs (tweet_id / author /
 * created_at / matched_queries / url / like / retweet) so the two toolchains
 * agree. Crucially, notes land in a normal vault folder, which means the
 * plugin's own surferBridge auto-indexer picks them up — closing the loop
 * between scraped tweets and the rest of the discourse/collocation machinery.
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import type { XTweet } from './x-types';

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]]/g, '_').replace(/\s+/g, '_').slice(0, 60);
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function yamlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Build a single note's content (frontmatter + body). */
export function tweetToMarkdown(t: XTweet): string {
  const fm: string[] = ['---'];
  fm.push(`tweet_id: ${yamlString(t.id)}`);
  fm.push(`author: ${yamlString(t.authorHandle)}`);
  fm.push(`authorName: ${yamlString(t.authorName)}`);
  fm.push(`created_at: ${yamlString(new Date(t.createdAt).toISOString())}`);
  fm.push(`url: ${yamlString(t.url)}`);
  fm.push(`lang: ${yamlString(t.lang)}`);
  fm.push(`like: ${t.favoriteCount}`);
  fm.push(`retweet: ${t.retweetCount}`);
  fm.push(`reply: ${t.replyCount}`);
  if (t.matchedQueries?.length) {
    fm.push('matched_queries:');
    for (const q of t.matchedQueries) fm.push(`  - ${yamlString(q)}`);
  }
  fm.push('tags:');
  fm.push('  - x/tweet');
  fm.push('---');
  return fm.join('\n') + '\n\n' + t.text + '\n';
}

export interface ExportResult {
  written: number;
  skipped: number;
  folder: string;
}

/**
 * Export tweets as notes under `folder`. Existing notes (same id) are skipped,
 * not clobbered. Returns counts.
 */
export async function exportTweetsToVault(
  app: App,
  tweets: XTweet[],
  folder: string,
): Promise<ExportResult> {
  const base = normalizePath(folder.trim() || 'X Tweets');
  if (!(await app.vault.adapter.exists(base))) {
    try { await app.vault.createFolder(base); } catch { /* race / already exists */ }
  }

  let written = 0;
  let skipped = 0;
  for (const t of tweets) {
    const name = `${isoDate(t.createdAt)}_${sanitize(t.authorHandle || 'unknown')}_${t.id}.md`;
    const path = normalizePath(`${base}/${name}`);
    if (await app.vault.adapter.exists(path)) {
      skipped++;
      continue;
    }
    try {
      await app.vault.create(path, tweetToMarkdown(t));
      written++;
    } catch {
      skipped++;
    }
  }
  return { written, skipped, folder: base };
}
