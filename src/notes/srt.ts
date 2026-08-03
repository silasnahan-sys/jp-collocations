/**
 * srt.ts — subtitle files (jimaku etc.) → standard transcript notes
 * (DESIGN §22, TV medium). PURE — golden-tested in golden/srt.mjs.
 *
 * Output is the EXACT transcript shape the rest of the plugin already
 * speaks (`[HH:MM:SS] text` lines + frontmatter), so reconcile, sweep,
 * 談話モード, and the ⚡ flow work on TV episodes with zero new machinery.
 */

export interface SrtCue {
  startSec: number;
  text: string;
}

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

const unbom = (raw: string): string => raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

/**
 * Parse a subtitle file in whatever format it arrived in — SRT, WebVTT or
 * ASS/SSA — and return timed cues.
 *
 * ASS is not an edge case: it is what anime subtitles actually are, both on
 * jimaku and inside the MKVs Plex serves. `parseSrt` looks for `-->` and so
 * returns ZERO cues for an ASS file, which surfaced as "the import did
 * nothing". Detection is by content, never by filename, because the Plex
 * stream endpoint hands back a body with no name attached.
 */
export function parseSubtitles(raw: string): SrtCue[] {
  const text = unbom(raw);
  const isAss = /^\s*\[Script Info\]/i.test(text)
    || /^\s*\[V4\+? Styles\]/im.test(text)
    || /^\s*Dialogue:/im.test(text);
  return isAss ? parseAss(text) : parseSrt(text);
}

/** Parse SRT or WebVTT. Styling tags stripped; blank/duplicate cues dropped. */
export function parseSrt(raw: string): SrtCue[] {
  const text = unbom(raw);
  const cues: SrtCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const m = lines[timeIdx].match(TIME_RE);
    if (!m) continue;
    const startSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const body = lines.slice(timeIdx + 1).join(' ')
      .replace(/<[^>]+>/g, '')          // <i>, <font …>
      .replace(/\{\\[^}]*\}/g, '')      // {\an8} positioning
      .trim();
    if (!body) continue;
    const prev = cues[cues.length - 1];
    if (prev && prev.text === body) continue;   // rolled-up duplicate
    cues.push({ startSec, text: body });
  }
  return cues;
}

/** ASS/SSA `H:MM:SS.cc`. Hours are not zero-padded in this format. */
const ASS_TIME = /^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/;

/** The field order every ASS file uses when it omits its own `Format:` line. */
const ASS_DEFAULT_FIELDS = [
  'layer', 'start', 'end', 'style', 'name',
  'marginl', 'marginr', 'marginv', 'effect', 'text',
];

/**
 * Parse ASS/SSA `[Events]`.
 *
 * Two things make this more than a split-on-comma:
 *
 *  • The field ORDER is declared per file by the `Format:` line, and `Text` is
 *    last precisely because it may contain commas — so the text field is the
 *    remainder, never `parts[9]`.
 *  • Typesetting and signs live in the same event stream as dialogue. After
 *    override blocks are stripped, a drawing command (`{\p1}m 0 0 l 100 0 …`)
 *    leaves a run of coordinates that would otherwise enter the transcript as
 *    a line of speech. Those are dropped, and `Comment:` events are skipped.
 */
export function parseAss(raw: string): SrtCue[] {
  const text = unbom(raw);
  let inEvents = false;
  let fields = ASS_DEFAULT_FIELDS;
  const found: SrtCue[] = [];

  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('[')) { inEvents = /^\[events\]/i.test(t); continue; }
    if (!inEvents) continue;

    if (/^format\s*:/i.test(t)) {
      fields = t.slice(t.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(t)) continue;   // skips Comment: and Picture:

    const startIdx = fields.indexOf('start');
    const textIdx = fields.indexOf('text');
    if (startIdx < 0 || textIdx < 0) continue;

    const parts = t.slice(t.indexOf(':') + 1).split(',');
    if (parts.length <= textIdx) continue;
    const m = ASS_TIME.exec(parts[startIdx]?.trim() ?? '');
    if (!m) continue;
    const startSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);

    const rawText = parts.slice(textIdx).join(',');       // Text is the remainder
    const isDrawing = /\\p[1-9]/.test(rawText);
    const body = rawText
      .replace(/\{[^}]*\}/g, '')     // {\an8}, {\pos(…)}, {\i1} …
      .replace(/\\[Nn]/g, ' ')       // hard and soft line breaks
      .replace(/\\h/g, ' ')          // hard space
      .replace(/\s+/g, ' ')
      .trim();
    if (!body || isDrawing) continue;
    found.push({ startSec, text: body });
  }

  // Events are not required to be in time order, and signs interleave with
  // dialogue — a transcript has to read forwards.
  found.sort((a, b) => a.startSec - b.startSec);
  const cues: SrtCue[] = [];
  for (const c of found) {
    const prev = cues[cues.length - 1];
    if (prev && prev.text === c.text) continue;
    cues.push(c);
  }
  return cues;
}

const pad = (n: number): string => String(n).padStart(2, '0');
export const fmtStamp = (sec: number): string =>
  `[${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}]`;

/**
 * A clock with no brackets, and no hour field it does not need.
 *
 * `fmtStamp` is the transcript's own notation — [00:12:34] belongs against a
 * line of dialogue. It is the wrong shape for a duration or a position readout,
 * where 「12:34 / 24:10」 is what the eye expects and the bracketed form reads as
 * two anchors rather than a progress figure.
 */
export const fmtDur = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

const yaml = (s: string): string => s.replace(/"/g, "'");

/**
 * The standard transcript note. `title` names the episode; sourceName the show
 * — both land in frontmatter so captures carry the scene.
 *
 * When the subtitle came from Plex, the server's own identifiers are written
 * alongside. That is what lets the note find its media again on a later day:
 * without them a transcript can only be re-synced while the episode happens to
 * be playing AND happens to fuzzy-match its own filename, and a clip can only
 * be cut during that same session. The identifiers cost two lines and keep the
 * scene reachable from the noticing (§28: provenance must survive the boundary).
 */
export function srtToNote(opts: {
  srt: string;
  title: string;
  sourceName?: string;
  /** where the subtitle came from: `jimaku` fetched, `plex` from the server. */
  subSource?: string;
  /** season / episode number, when the source knew them. */
  episode?: { season?: number; episode?: number };
  /** Plex provenance — the episode and the media part it was read from. */
  plex?: { ratingKey?: string; partKey?: string; lang?: string };
  /**
   * jimaku provenance — which entry and which FILE this text came from. A
   * fetched subtitle is a choice among several releases, and it is the one
   * thing about the note that can be WRONG in a way the text does not show,
   * so the choice is recorded where a re-fetch can be judged against it.
   */
  jimaku?: { entryId?: number; fileName?: string; url?: string };
  /**
   * Seconds to add to these stamps to line up with the video (§25.4b).
   * Zero and present, rather than absent, when the subtitle came from
   * somewhere other than the video file itself: that is exactly the case where
   * the two clocks can disagree, and a field you can see is a field you can
   * fix (鑑賞モード's ⌖ writes it back).
   */
  subOffsetSec?: number;
}): { content: string; cueCount: number } {
  const cues = parseSubtitles(opts.srt);
  const fm = [
    '---',
    'source: tv',
    `title: "${yaml(opts.title)}"`,
    ...(opts.sourceName ? [`show: "${yaml(opts.sourceName)}"`] : []),
    `sub_source: ${opts.subSource ?? 'jimaku'}`,
    ...(opts.episode?.season != null ? [`season: ${opts.episode.season}`] : []),
    ...(opts.episode?.episode != null ? [`episode: ${opts.episode.episode}`] : []),
    ...(opts.plex?.ratingKey ? [`plex_rating_key: "${yaml(opts.plex.ratingKey)}"`] : []),
    ...(opts.plex?.partKey ? [`plex_part_key: "${yaml(opts.plex.partKey)}"`] : []),
    ...(opts.plex?.lang ? [`sub_lang: ${yaml(opts.plex.lang)}`] : []),
    ...(opts.jimaku?.entryId != null ? [`jimaku_entry: ${opts.jimaku.entryId}`] : []),
    ...(opts.jimaku?.fileName ? [`jimaku_file: "${yaml(opts.jimaku.fileName)}"`] : []),
    ...(opts.subOffsetSec != null ? [`sub_offset_sec: ${opts.subOffsetSec}`] : []),
    '---',
    '',
    `# ${opts.title}`,
    '',
  ];
  const body = cues.map((c) => `${fmtStamp(c.startSec)} ${c.text}`);
  return { content: [...fm, ...body, ''].join('\n'), cueCount: cues.length };
}
