/**
 * tweet-format.ts — pure formatting for tweets leaving the X view.
 *
 * A tweet becomes a `> [!x-tweet]` callout block: a first-class, indexable
 * markdown object (searchable via `"[!x-tweet]"`, dataview-able, styleable via
 * `.callout[data-callout="x-tweet"]`). The SAME block is used by "insert into
 * editor" and "append to collection", so every saved tweet in the vault has one
 * canonical shape. Pure functions only — golden-tested in golden/x-format.mjs.
 */

import type { XTweet } from './x-types';

/** Options for formatting a tweet as a callout block. */
export interface CalloutOptions {
  /**
   * Collocation surfaces picked out of this tweet (possibly gapped, e.g.
   * "この…も…まで"). Rendered as a 🔖 line of inline code so they are findable
   * and machine-parseable later.
   */
  collocations?: string[];
  /** Embed photo/video thumbnails as images inside the callout. Default true. */
  includeMedia?: boolean;
}

/** YYYY/MM/DD from epoch ms (local time — matches the card display). */
export function formatDateYMD(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/**
 * Format one tweet as a `[!x-tweet]` callout block (no trailing newline).
 *
 * > [!x-tweet] [@handle](https://x.com/…/status/…) ・ 2026/06/30
 * > 今週頭からトレーニング休んでて…
 * > この調子もさすがに今日まで…と思いたい🥶
 * >
 * > 🔖 `この…も…まで` `さすがに`
 * > ![](https://pbs.twimg.com/media/…?name=small)
 * > ❤ 12 🔁 3 💬 1
 */
export function formatTweetCallout(t: XTweet, opts: CalloutOptions = {}): string {
  const lines: string[] = [];
  const handle = t.authorHandle ? `@${t.authorHandle}` : (t.authorName || 'X');
  lines.push(`> [!x-tweet] [${handle}](${t.url}) ・ ${formatDateYMD(t.createdAt)}`);

  // Body: preserve the tweet's own linebreaks; every line quoted.
  for (const raw of t.text.replace(/\r\n?/g, '\n').split('\n')) {
    lines.push(raw ? `> ${raw}` : '>');
  }

  const collocations = (opts.collocations ?? []).map(c => c.trim()).filter(Boolean);
  const media = opts.includeMedia === false ? [] : (t.media ?? []);
  const metrics = `❤ ${t.favoriteCount} 🔁 ${t.retweetCount} 💬 ${t.replyCount}`;

  lines.push('>');
  if (collocations.length > 0) {
    lines.push(`> 🔖 ${collocations.map(c => `\`${c.replace(/`/g, "'")}\``).join(' ')}`);
  }
  for (const m of media) {
    // Photo thumbs embed directly; video/gif get a linked poster frame.
    if (m.type === 'photo') lines.push(`> ![](${m.thumb})`);
    else lines.push(`> [▶ ![](${m.thumb})](${m.url})`);
  }
  lines.push(`> ${metrics}`);
  return lines.join('\n');
}

/**
 * Join gapped collocation parts into a display surface: この + も + まで →
 * "この…も…まで". Single part passes through unchanged.
 */
export function joinCollocationParts(parts: string[]): string {
  return parts.map(p => p.trim()).filter(Boolean).join('…');
}

/**
 * Should a tweet body start collapsed in the results list? Estimated from the
 * text alone (no DOM measurement → no forced reflow while rendering hundreds
 * of cards). Roughly: more than ~6 visual lines at sidebar width.
 */
export function shouldCollapse(text: string, charsPerLine = 22, maxLines = 6): boolean {
  let lines = 0;
  for (const seg of text.replace(/\r\n?/g, '\n').split('\n')) {
    lines += Math.max(1, Math.ceil(seg.length / charsPerLine));
    if (lines > maxLines) return true;
  }
  return false;
}
