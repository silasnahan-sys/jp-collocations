/**
 * medium-lines.ts — every medium as `MatcherLine[]` (AUDIT-2026-08-01 §6.7 item 3).
 *
 * The sweep and the reconciler both take LINES, not transcripts —
 * `sweepEntry` already reads `lines[i].tStartSec ?? null`, so it has always
 * been medium-agnostic. The restriction was never in the matcher: it was that
 * only `parseTranscriptLines` produced lines, and it gates on
 * `CAPTION_STAMP_RE`. So a phrase you flicked in from a tweet or a note.com
 * article could be classified but never reconciled — Road A's speed and Road B's
 * artefact could not meet for anything but captioned video.
 *
 * The irony worth recording: reading notes were already being handed to the
 * sweep. `import-written` writes them into the transcript folder, so the sweep
 * opened every one of them, found no `[HH:MM:SS]`, and dropped them. The
 * material was in the right place and unreadable for want of an adapter.
 *
 * This module is that adapter, one function per shape. PURE — no Obsidian, no
 * I/O — golden-tested in golden/medium-lines.mjs.
 *
 * On the unit: a SENTENCE, not a paragraph. `sweepEntry` quotes a window around
 * its match, so an over-long line yields an attestation quoting half an essay,
 * and an over-short one loses the context that makes a sighting judgeable. For
 * captions the cue is already sentence-scale, which is why transcripts read well
 * — prose has to be cut to match.
 */

import type { MatcherLine } from './local-matcher.ts';

/** Japanese sentence enders, kept attached to the sentence they close. */
const SENT_SPLIT = /(?<=[。！？!?])/;

/** Frontmatter block of a note, or '' when there is none. */
function frontmatter(md: string): string {
  return md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
}

/** Body with frontmatter removed. */
function body(md: string): string {
  return md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

/**
 * What kind of reading note this is, or null if it is not one.
 *
 * Keys are exactly what `import-written` writes: `source: book|note`, plus
 * `book_title:` or `site:` for the name and an optional `url:`.
 */
export function readingSource(md: string): { medium: 'book' | 'note'; sourceName?: string; url?: string } | null {
  const fm = frontmatter(md);
  const m = fm.match(/^\s*source:\s*(book|note)\s*$/m);
  if (!m) return null;
  const name = fm.match(/^\s*(?:book_title|site|title):\s*"?([^"\n]+?)"?\s*$/m)?.[1]?.trim();
  const url = fm.match(/^\s*url:\s*"?([^"\n]+?)"?\s*$/m)?.[1]?.trim();
  return { medium: m[1] as 'book' | 'note', ...(name ? { sourceName: name } : {}), ...(url ? { url } : {}) };
}

/**
 * Prose (Kindle highlights, note.com articles) → sentence lines.
 *
 * Markdown furniture is dropped rather than matched: a heading, an embed or a
 * bare URL is the plugin's or the author's scaffolding, never something the
 * user "heard", and letting it through produces attestations quoting a filename.
 * This is the same reasoning `extractNotePhrases` applies on the way in.
 */
export function proseLines(md: string): MatcherLine[] {
  const out: MatcherLine[] = [];
  let index = 0;
  for (const raw of body(md).split('\n')) {
    let t = raw.trim();
    if (!t) continue;
    if (t.startsWith('#') || t.startsWith('>') || t.startsWith('---') || t.startsWith('```')) continue;
    if (/^!?\[\[[^\]]*\]\]$/.test(t) || t.startsWith('![') || /^https?:\/\/\S+$/.test(t)) continue;
    t = t.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/^\[[ x]\]\s+/, '');
    t = t.replace(/[*_`~]/g, '').trim();
    if (t.length < 2) continue;
    for (const s of t.split(SENT_SPLIT)) {
      const line = s.trim();
      if (line.length >= 2) out.push({ index: index++, text: line });
    }
  }
  return out;
}

/** One captured tweet, reduced to what a sweep needs. */
export interface TweetLike {
  id: string;
  url: string;
  text: string;
  authorHandle?: string;
  createdAt?: number;
  lang?: string;
}

/**
 * A tweet → sentence lines.
 *
 * Handles the long-form case (`note_tweet` can run to thousands of characters),
 * so a match quotes its sentence rather than the whole post. The t.co tail and
 * @-mention head are stripped: both are addressing, not language the user is
 * learning, and both otherwise match as "context" around a hit.
 */
export function tweetLines(text: string): MatcherLine[] {
  const cleaned = text
    .replace(/https?:\/\/t\.co\/\w+/g, ' ')
    .replace(/^(?:@\w+\s+)+/, '')
    .replace(/[ \t　]+/g, ' ')
    .trim();
  const out: MatcherLine[] = [];
  let index = 0;
  for (const para of cleaned.split('\n')) {
    const p = para.trim();
    if (!p) continue;
    for (const s of p.split(SENT_SPLIT)) {
      const line = s.trim();
      if (line.length >= 2) out.push({ index: index++, text: line });
    }
  }
  return out;
}

/**
 * Only worth sweeping if there is Japanese in it. X returns a lot of English,
 * and running every catalog entry over it costs time and can only produce
 * false sightings — no Japanese collocation is attested by an English tweet.
 */
export function hasJapanese(text: string): boolean {
  return /[぀-ゟ゠-ヿ一-鿿]/.test(text);
}

/** Tweets worth sweeping, newest first. `lang` is X's own tag — trusted when
 *  it says `ja`, and ignored otherwise in favour of looking at the text. */
export function sweepableTweets<T extends TweetLike>(tweets: T[]): T[] {
  return tweets
    .filter((t) => t.lang === 'ja' || hasJapanese(t.text))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
