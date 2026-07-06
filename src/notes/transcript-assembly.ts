/**
 * transcript-assembly.ts — write a fetched Transcript into Markdown (DESIGN §1.3,
 * invariants #1 markdown-is-truth, #4 fetch-once-freeze, #5 idempotent).
 *
 * Two shapes, both pure so the golden harness can diff them:
 *  - `renderTranscriptFile` — a standalone transcript NOTE (frontmatter + timestamped
 *    lines). This is the unit the rest of the pipeline already consumes: its `video:`
 *    frontmatter lights up reconcile / cards / audio with no further wiring, and a
 *    notes file points at it via `source: [[…]]`.
 *  - `renderVideoSection` + `upsertVideoSection` — the DESIGN §1.3 daily-note form:
 *    the transcript under a per-video heading, inserted once and then FROZEN (a
 *    stable `%% yt:<id> %%` marker means a re-run never re-fetches or rewrites it).
 *
 * Line stamps are `[H:MM:SS]` / `[MM:SS]` — exactly what `parseTranscriptLines`
 * reads back, so the written file round-trips through the matcher.
 */

import type { Transcript, TranscriptLine } from './transcript.ts';

const pad = (n: number) => String(n).padStart(2, '0');

/** Seconds → `[H:MM:SS]` (hours only when needed) — matches parseTranscriptLines. */
export function stampOf(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/** Filesystem-safe base name for a transcript note: `<title> (<videoId>)`. */
export function transcriptFileBaseName(t: Transcript): string {
  const safe = (t.title || t.videoId)
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')   // illegal on Windows / awkward in wikilinks
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || t.videoId;
  // Don't double-stamp the id if the title already ends with it.
  return safe.includes(t.videoId) ? safe : `${safe} (${t.videoId})`;
}

function bodyLines(lines: TranscriptLine[]): string[] {
  return lines.map((l) => `[${stampOf(l.tStartSec)}] ${l.text}`);
}

/** A standalone transcript note (YAML frontmatter + timestamped body). */
export function renderTranscriptFile(t: Transcript): string {
  const iso = new Date(t.fetchedAt).toISOString();
  const out: string[] = [];
  out.push('---');
  out.push(`video: ${t.url}`);
  out.push(`videoId: ${t.videoId}`);
  out.push(`title: ${yamlScalar(t.title)}`);
  out.push(`lang: ${t.lang}`);
  out.push(`source: ${t.source}`);
  out.push(`fetched: ${iso}`);
  out.push(`lines: ${t.lines.length}`);
  out.push('---');
  out.push('');
  out.push(`# ${t.title}`);
  out.push('');
  out.push(`> ▶ ${t.url} ｜ ${t.lang} ｜ ${t.source} ｜ ${t.lines.length} 行 ｜ 取得 ${iso.slice(0, 10)}`);
  out.push('> 文字起こしは取得時点で凍結（再取得しない）。照合の「原文」＝真実。');
  out.push('');
  out.push(...bodyLines(t.lines));
  out.push('');
  return out.join('\n');
}

/** Quote a YAML scalar only when it could break the parse (keeps titles readable). */
function yamlScalar(s: string): string {
  // Characters/shapes that are unsafe unquoted in YAML flow context.
  const unsafe = /[:#\[\]{}&*!|>'"%@`,]/.test(s) || /^[\s?-]/.test(s) || /\s$/.test(s) || s === '';
  return unsafe ? JSON.stringify(s) : s;
}

// ── daily-note section form (DESIGN §1.3) ───────────────────────────────────────

/** The stable marker that identifies a video's section (and makes it idempotent). */
export function videoMarker(videoId: string): string {
  return `%% yt:${videoId} %%`;
}

/** A per-video transcript section for embedding in a daily note. */
export function renderVideoSection(t: Transcript): string {
  const iso = new Date(t.fetchedAt).toISOString();
  const out: string[] = [];
  out.push(`## ▶ ${t.title} ${videoMarker(t.videoId)}`);
  out.push(`> ${t.url} ｜ ${t.lang} ｜ ${t.source} ｜ ${t.lines.length} 行 ｜ 取得 ${iso.slice(0, 10)}`);
  out.push('');
  out.push(...bodyLines(t.lines));
  out.push('');
  return out.join('\n');
}

/**
 * Insert a video's transcript section into a daily-note document, once. If a
 * section with the same `%% yt:<id> %%` marker is already present the document is
 * returned UNCHANGED (invariant #4 freeze). Otherwise the section is appended.
 */
export function upsertVideoSection(dailyMd: string, t: Transcript): { md: string; changed: boolean } {
  if (dailyMd.includes(videoMarker(t.videoId))) return { md: dailyMd, changed: false };
  const sep = dailyMd.length && !dailyMd.endsWith('\n\n') ? (dailyMd.endsWith('\n') ? '\n' : '\n\n') : '';
  return { md: dailyMd + sep + renderVideoSection(t) + '\n', changed: true };
}
