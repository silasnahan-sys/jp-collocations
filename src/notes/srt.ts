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

/** Parse SRT or WebVTT. Styling tags stripped; blank/duplicate cues dropped.
 *  (.ass is not supported — convert to .srt first; jimaku offers both.) */
export function parseSrt(raw: string): SrtCue[] {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
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

const pad = (n: number): string => String(n).padStart(2, '0');
export const fmtStamp = (sec: number): string =>
  `[${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(Math.floor(sec % 60))}]`;

/** The standard transcript note. `title` names the episode; sourceName the
 *  show — both land in frontmatter so captures carry the scene. */
export function srtToNote(opts: {
  srt: string;
  title: string;
  sourceName?: string;
}): { content: string; cueCount: number } {
  const cues = parseSrt(opts.srt);
  const fm = [
    '---',
    'source: tv',
    `title: "${opts.title.replace(/"/g, "'")}"`,
    ...(opts.sourceName ? [`show: "${opts.sourceName.replace(/"/g, "'")}"`] : []),
    'sub_source: jimaku',
    '---',
    '',
    `# ${opts.title}`,
    '',
  ];
  const body = cues.map((c) => `${fmtStamp(c.startSec)} ${c.text}`);
  return { content: [...fm, ...body, ''].join('\n'), cueCount: cues.length };
}
