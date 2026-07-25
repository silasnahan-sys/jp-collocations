/**
 * context-window.ts — locate an attestation inside its transcript and build
 * the ±N-turn context window around it (DESIGN §20.2). PURE — golden-tested
 * in golden/context.mjs.
 *
 * Accuracy contract:
 *  - The anchor line is found by QUOTE match first (the quote is the located
 *    span — the strongest evidence), timestamp proximity second. If neither
 *    locates it, `located: false` — the caller renders the stored quote and
 *    NEVER a wrong window.
 *  - Turn boundaries and speakers come from the user's ratified 談話モード
 *    segmentation (`_discourseSeg`) when present — human truth outranks the
 *    line heuristic. Without a seg, each caption line is its own row and NO
 *    speaker is invented.
 *  - Highlighting is inflection-aware via the same deinflect-validated
 *    matcher the sweep uses (気になって lights up for 気になる) and never
 *    highlights across a match the validator can't confirm.
 */

import { findTermAll } from './sweep-match.ts';
import { normalizeJapanese } from '../utils/japanese.ts';
import { turnLineSlices } from '../discourse/turns.ts';
import type { MatcherLine } from './local-matcher.ts';

export interface SegTurn { start: number; char?: number; speaker: string }
export interface SegLike { turns: SegTurn[] }

export interface ContextSegment { text: string; hit: boolean }

export interface ContextTurn {
  /** speaker letter from the RATIFIED seg; absent = never invented. */
  speaker?: string;
  tStartSec?: number;
  isAnchor: boolean;
  segments: ContextSegment[];
}

export interface ContextWindowData {
  located: boolean;
  turns: ContextTurn[];
}

const norm = (s: string): string => normalizeJapanese(s).replace(/\s+/g, '');

/** Find the line index the attestation points at, or -1. */
export function locateAnchorLine(
  lines: MatcherLine[],
  att: { tStartSec?: number | null; quote: string },
): number {
  const q = norm(att.quote);
  // quote match — the located span is the strongest evidence. Long quotes may
  // straddle two caption lines, so also try the quote's head.
  const probes = q.length >= 4 ? [q, q.slice(0, Math.min(10, q.length))] : q ? [q] : [];
  let candidates: number[] = [];
  for (const probe of probes) {
    // a line containing the probe ITSELF beats one that only matches via the
    // straddle-join with its successor (else the previous line false-anchors)
    const own = lines.reduce<number[]>((acc, l, i) => (norm(l.text).includes(probe) ? (acc.push(i), acc) : acc), []);
    if (own.length) { candidates = own; break; }
    candidates = lines.reduce<number[]>((acc, l, i) => {
      const joined = norm(l.text) + norm(lines[i + 1]?.text ?? '');
      if (joined.includes(probe)) acc.push(i);
      return acc;
    }, []);
    if (candidates.length) break;
  }
  const t = att.tStartSec;
  if (candidates.length) {
    if (t == null) return candidates[0];
    let best = candidates[0], bestD = Infinity;
    for (const i of candidates) {
      const lt = lines[i].tStartSec;
      const d = lt == null ? Infinity : Math.abs(lt - t);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  // timestamp proximity only — accept a near line, refuse a distant one
  if (t != null) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const lt = lines[i].tStartSec;
      if (lt == null) continue;
      const d = Math.abs(lt - t);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD <= 8) return best;
  }
  return -1;
}

/** Split `text` into hit/miss segments for the given terms (inflection-aware,
 *  deinflect-validated — a span only highlights if the matcher confirms it). */
export function highlightSegments(text: string, terms: string[]): ContextSegment[] {
  const spans: { start: number; end: number }[] = [];
  const seen = new Set<string>();
  for (const raw of terms) {
    const t = (raw ?? '').trim();
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    const variants = new Set([t, norm(t)]);
    for (const v of variants) {
      if (v.length < 2) continue;
      for (const o of findTermAll(text, v)) spans.push({ ...o.span });
    }
  }
  if (!spans.length) return [{ text, hit: false }];
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  // merge overlaps
  const merged: { start: number; end: number }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  const out: ContextSegment[] = [];
  let cursor = 0;
  for (const s of merged) {
    if (s.start > cursor) out.push({ text: text.slice(cursor, s.start), hit: false });
    out.push({ text: text.slice(s.start, s.end), hit: true });
    cursor = s.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

// ── §22.2 prose mode: book / note.com — the PARAGRAPH is the context ──

export interface ProsePara {
  text: string;
  isAnchor: boolean;
  segments: ContextSegment[];
}

export interface ProseWindowData {
  located: boolean;
  paras: ProsePara[];
}

/** Strip YAML frontmatter, split into paragraphs on blank lines. */
export function proseParagraphs(body: string): string[] {
  const noFm = body.replace(/^---\n[\s\S]*?\n---\n/, '');
  return noFm.split(/\n{2,}/).map((p) => p.replace(/\n/g, '')).map((p) => p.trim()).filter(Boolean);
}

/**
 * ±radius paragraphs around the one containing the quote. Written context is
 * FLOW, not turns: no speakers, no timestamps — the paragraph either
 * contains the located span or the window is refused (located: false).
 */
export function buildProseWindow(input: {
  body: string;
  att: { quote: string };
  highlightTerms: string[];
  radius?: number;
}): ProseWindowData {
  const radius = input.radius ?? 1;
  const paras = proseParagraphs(input.body);
  const q = norm(input.att.quote);
  const probes = q.length >= 4 ? [q, q.slice(0, Math.min(12, q.length))] : q ? [q] : [];
  let anchor = -1;
  for (const probe of probes) {
    anchor = paras.findIndex((p) => norm(p).includes(probe));
    if (anchor >= 0) break;
  }
  if (anchor < 0) return { located: false, paras: [] };
  const terms = [...input.highlightTerms, input.att.quote];
  const out: ProsePara[] = [];
  for (let i = Math.max(0, anchor - radius); i <= Math.min(paras.length - 1, anchor + radius); i++) {
    out.push({
      text: paras[i],
      isAnchor: i === anchor,
      segments: highlightSegments(paras[i], i === anchor ? terms : input.highlightTerms),
    });
  }
  return { located: true, paras: out };
}

export interface BuildContextInput {
  lines: MatcherLine[];
  att: { tStartSec?: number | null; quote: string };
  /** ratified 談話モード segmentation for this file, if any. */
  seg?: SegLike | null;
  /** what to light up: the entry key, its parts/frame, the quote itself. */
  highlightTerms: string[];
  /** turns (or lines, without a seg) of context on each side. */
  radius?: number;
}

export function buildContextWindow(input: BuildContextInput): ContextWindowData {
  const { lines, att, seg } = input;
  const radius = input.radius ?? 2;
  const anchorLine = locateAnchorLine(lines, att);
  if (anchorLine < 0) return { located: false, turns: [] };
  const terms = [...input.highlightTerms, att.quote];

  const mkTurn = (text: string, tStartSec: number | undefined, isAnchor: boolean, speaker?: string): ContextTurn => ({
    ...(speaker ? { speaker } : {}),
    tStartSec,
    isAnchor,
    segments: highlightSegments(text, isAnchor ? terms : input.highlightTerms),
  });

  if (seg?.turns?.length) {
    // ratified turn boundaries (sentence-grain: (line,char) — §23.4-2):
    // group line SLICES into turns, window by TURN
    const starts = [...seg.turns].sort((a, b) => a.start - b.start || (a.char ?? 0) - (b.char ?? 0));
    let anchorTurn = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i].start <= anchorLine) anchorTurn = i;
    const from = Math.max(0, anchorTurn - radius);
    const to = Math.min(starts.length - 1, anchorTurn + radius);
    const turns: ContextTurn[] = [];
    for (let i = from; i <= to; i++) {
      const slices = turnLineSlices(lines, starts, i);
      if (!slices.length) continue;
      turns.push(mkTurn(
        slices.map((s) => s.text).join(' '),
        lines[starts[i].start]?.tStartSec,
        i === anchorTurn,
        starts[i].speaker,
      ));
    }
    return { located: true, turns };
  }

  // no seg: line-based window. Speakers are still never INVENTED — but a
  // diarized transcript's letters (§23.4-3, MatcherLine.speaker) are heard
  // layer-1 truth, so they ride through.
  const from = Math.max(0, anchorLine - radius);
  const to = Math.min(lines.length - 1, anchorLine + radius);
  const turns: ContextTurn[] = [];
  for (let i = from; i <= to; i++) {
    turns.push(mkTurn(lines[i].text, lines[i].tStartSec, i === anchorLine, lines[i].speaker));
  }
  return { located: true, turns };
}
