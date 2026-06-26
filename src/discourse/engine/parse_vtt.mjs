// _tmp_pipeline/parse_vtt.mjs
// Parse WebVTT (and VTT-like) input into normalized cue records.
//
// YouTube auto-caption peculiarities handled:
//  - rolling captions where each cue contains the PREVIOUS line PLUS a new
//    line (we keep only the last line of each cue)
//  - 10-millisecond filler cues that contain only a space or duplicate text
//  - inline timing tags <00:00:01.234> stripped
//  - align/position metadata stripped from the timing line
//  - cues that are empty after cleanup are dropped (but their existence
//    contributes to pause detection)
//
// Output: array of { startMs, endMs, text, durationMs }.

import { normalize } from './normalize.mjs';

const TIMING_RE = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

function toMs(h, m, s, ms) {
  return (+h) * 3600_000 + (+m) * 60_000 + (+s) * 1000 + (+ms);
}

/** @returns {{cues: Array<{startMs:number,endMs:number,text:string,durationMs:number}>, stats: object}} */
export function parseVtt(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  /** @type {Array<{startMs:number,endMs:number,text:string,durationMs:number}>} */
  const cues = [];
  let i = 0;
  let dropped = 0;

  while (i < lines.length) {
    const line = lines[i];
    const tm = TIMING_RE.exec(line);
    if (!tm) { i++; continue; }
    const startMs = toMs(tm[1], tm[2], tm[3], tm[4]);
    const endMs   = toMs(tm[5], tm[6], tm[7], tm[8]);
    i++;
    /** @type {string[]} */
    const buf = [];
    while (i < lines.length && lines[i].trim() !== '' && !TIMING_RE.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length === 0) { dropped++; continue; }
    // Rolling-caption heuristic: keep last non-empty line only.
    const lastNonEmpty = [...buf].reverse().find(l => l.trim() !== '') ?? '';
    const norm = normalize(lastNonEmpty);
    if (!norm.text) { dropped++; continue; }
    cues.push({
      startMs, endMs,
      durationMs: endMs - startMs,
      text: norm.text,
    });
  }

  // Cross-cue dedup: many YouTube caption tracks emit the same line twice
  // (once as it appears, once with the next line appended). Drop consecutive
  // exact duplicates.
  /** @type {Array<{startMs:number,endMs:number,text:string,durationMs:number}>} */
  const deduped = [];
  for (const c of cues) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.text === c.text) {
      prev.endMs = c.endMs;
      prev.durationMs = prev.endMs - prev.startMs;
      continue;
    }
    deduped.push(c);
  }

  return {
    cues: deduped,
    stats: { rawCues: cues.length, dedupedCues: deduped.length, droppedEmpty: dropped },
  };
}

/** Parse SRT — same shape as VTT for downstream uniformity. */
export function parseSrt(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '').replace(/,(\d{3})/g, '.$1');
  // Strip numeric index lines, then reuse VTT parser.
  const stripped = text.split(/\r?\n/).filter(l => !/^\d+$/.test(l.trim())).join('\n');
  return parseVtt('WEBVTT\n\n' + stripped);
}
