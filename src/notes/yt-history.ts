/**
 * yt-history.ts — ⚠ the ONLY file that knows how to turn a YouTube watch-history
 * export into `WatchedVideo[]` (DESIGN §4 YtHistoryAdapter, isolation invariant #2).
 *
 * HONESTY NOTE: a *live* scrape of watch history is not reliably possible from a
 * plugin — the history page is a login-gated JS SPA and InnerTube's history browse
 * needs SAPISIDHASH cookie auth that rotates and breaks. Rather than ship a fake
 * "live" path that silently returns nothing, this adapter ingests the two sources
 * that actually work and are fully under the user's control (invariant #3 degrade,
 * #7 nothing-wrong-silently):
 *
 *   1. Google Takeout `watch-history.json` — the reliable, complete export.
 *   2. Google Takeout `watch-history.html` — the same, in the older HTML form.
 *   3. A pasted list of URLs/IDs — the always-available manual fallback.
 *
 * All parsers are PURE (no I/O) so the golden harness exercises them on fixtures.
 * The pipeline then feeds each `WatchedVideo.id` to the TranscriptAdapter.
 */

import { parseYouTubeId } from './audio-provider.ts';

export interface WatchedVideo {
  id: string;        // YouTube video id (stable key)
  title: string;
  url: string;
  watchedAt: number; // epoch ms; 0 when the source carries no timestamp
}

export interface DateRange { since: number; until: number; }

/** How a batch of watched videos was obtained (for logging/provenance). */
export type HistorySource = 'takeout-json' | 'takeout-html' | 'paste';

/** Parse Google Takeout `watch-history.json`. Skips ads, removed videos, and
 *  non-watch activity; dedupes by id keeping the most recent occurrence. */
export function parseWatchHistoryJson(text: string): WatchedVideo[] {
  let arr: unknown;
  try { arr = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: WatchedVideo[] = [];
  for (const eRaw of arr) {
    const e = eRaw as {
      header?: string; title?: string; titleUrl?: string; time?: string;
      details?: { name?: string }[];
    };
    if (e.header && e.header !== 'YouTube') continue;               // Music/ads live under other headers
    if (Array.isArray(e.details) && e.details.some((d) => /From Google Ads/i.test(d?.name ?? ''))) continue;
    const id = parseYouTubeId(e.titleUrl);
    if (!id) continue;                                             // removed video / survey / no url
    const title = (e.title ?? '').replace(/^Watched\s+/i, '').trim() || id;
    const ts = e.time ? Date.parse(e.time) : NaN;
    out.push({ id, title, url: `https://youtu.be/${id}`, watchedAt: Number.isNaN(ts) ? 0 : ts });
  }
  return dedupe(out);
}

/** Parse Google Takeout `watch-history.html` (the older export form). */
export function parseWatchHistoryHtml(html: string): WatchedVideo[] {
  const out: WatchedVideo[] = [];
  // Each cell: <a href="https://www.youtube.com/watch?v=ID">Title</a> … <br>timestamp
  const cellRe = /<a href="(https?:\/\/www\.youtube\.com\/watch\?v=[^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a href="https?:\/\/www\.youtube\.com\/watch|<\/div>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(html))) {
    const id = parseYouTubeId(m[1]);
    if (!id) continue;
    const title = stripTags(m[2]) || id;
    // The trailing chunk usually ends with a localized date like "Jan 2, 2024, 3:04:05 PM PST".
    const dateMatch = m[3].match(/([A-Z][a-z]{2} \d{1,2}, \d{4}, [^<]+?(?:[AP]M)[^<]*)/);
    const ts = dateMatch ? Date.parse(dateMatch[1].replace(/\s+[A-Z]{2,4}$/, '')) : NaN;
    out.push({ id, title, url: `https://youtu.be/${id}`, watchedAt: Number.isNaN(ts) ? 0 : ts });
  }
  return dedupe(out);
}

/** Parse a pasted list of URLs and/or bare 11-char ids (one per line or whitespace). */
export function parsePastedVideos(text: string): WatchedVideo[] {
  const out: WatchedVideo[] = [];
  for (const tok of text.split(/[\s,]+/)) {
    const id = parseYouTubeId(tok);
    if (id) out.push({ id, title: id, url: `https://youtu.be/${id}`, watchedAt: 0 });
  }
  return dedupe(out);
}

/** Auto-detect the export shape and parse it. */
export function parseHistory(text: string): { videos: WatchedVideo[]; source: HistorySource } {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const videos = parseWatchHistoryJson(text);
    if (videos.length) return { videos, source: 'takeout-json' };
  }
  if (/<a href="https?:\/\/www\.youtube\.com\/watch/.test(text)) {
    const videos = parseWatchHistoryHtml(text);
    if (videos.length) return { videos, source: 'takeout-html' };
  }
  return { videos: parsePastedVideos(text), source: 'paste' };
}

/** Keep only videos watched within [since, until]. Entries with watchedAt 0
 *  (no timestamp — e.g. pasted) are always kept (can't be excluded honestly). */
export function filterByRange(videos: WatchedVideo[], range: DateRange): WatchedVideo[] {
  return videos.filter((v) => v.watchedAt === 0 || (v.watchedAt >= range.since && v.watchedAt <= range.until));
}

function dedupe(videos: WatchedVideo[]): WatchedVideo[] {
  const seen = new Map<string, WatchedVideo>();
  for (const v of videos) {
    const prev = seen.get(v.id);
    if (!prev || v.watchedAt > prev.watchedAt) seen.set(v.id, v);   // keep most-recent watch
  }
  return [...seen.values()];
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
