/**
 * sweep-match.ts — CLASS-AWARE candidate matchers for the transcript sweep.
 *
 * The sweep is a CANDIDATE machine, not a truth machine. The note classes are
 * defined by semantic tests (evocation / rearrangement / responsivity) that no
 * surface matcher can run — so everything this module finds is a SUGGESTION
 * (`status:'suggested'` on the attestation) awaiting one-tap ratification.
 * Only the 🟡 near-verbatim reconcile path (in main.ts, ≥0.9) writes confirmed
 * attestations, because there the unit IS the surface.
 *
 * Per class, the parse the class actually calls for:
 *   🔵 collocation   — every component present in order in a tight window,
 *                      final component may be INFLECTED (deinflect-validated);
 *                      a bare surface key also matches under inflection
 *                      (気になる attests 気になって).
 *   🟠 skeletal link — every link part present, in order, clause-scale gaps.
 *   💠 phrase schema — the frame's fixed material in order with a BOUNDED
 *                      filled slot between segments (○○ actually filled).
 *   🟢 rhet-coll     — the captured HALO rendering (near-verbatim, tail may
 *                      inflect). A bare lemma hit is NOT a sighting of the
 *                      gesture — the evocation test is human-only — so
 *                      lemma-only entries are not sweepable at all.
 *   🔴 discourse     — not swept (responsivity test; parser work halted).
 *
 * PURE — no Obsidian imports — golden-tested in golden/sweep.mjs.
 */

import { normalizeJapanese } from '../utils/japanese.ts';
import { deinflect } from '../dictionary/deinflect.ts';
import type { MatcherLine } from './local-matcher.ts';
import type { PatternEntry } from './pattern-store.ts';

export type SweepMatchKind = 'surface-inflected' | 'components' | 'link' | 'frame' | 'halo';

export interface SweepCandidate {
  tStartSec: number | null;
  /** just-enough context: the matched span ± a few chars of its window. */
  quote: string;
  confidence: number;
  matchKind: SweepMatchKind;
}

interface Span { start: number; end: number }

const norm = (s: string): string => normalizeJapanese(s).replace(/\s+/g, '');

/** Tails that can carry verbal inflection — only these are worth deinflecting. */
const CONJ_TAIL_RE = /[うくぐすつぬぶむる]$/;
/** Longest inflected tail we try to consume beyond the stem (ませんでした = 6). */
const MAX_INFLECTION_EXT = 8;

const KANJI_RE = /[㐀-䶿一-鿿々]/;
/**
 * A kanji-initial match preceded by exactly ONE kanji is almost always the
 * tail of a compound — a different lexeme (本|気になる, 口|約束). A run of 2+
 * kanji before the match is a complete word of its own (毎日|食べる,
 * 映画|見た — particle-dropped speech is normal in captions), so it must stay
 * legal. Kana junctions are always legal. This is the only compound-blindness
 * case decidable without morphology; the rest is the ✓✕ record's job.
 */
function compoundPrefixed(hay: string, span: Span): boolean {
  if (span.start === 0) return false;
  if (!KANJI_RE.test(hay[span.start]) || !KANJI_RE.test(hay[span.start - 1])) return false;
  return span.start < 2 || !KANJI_RE.test(hay[span.start - 2]);
}

/**
 * All occurrences of `term` in `hay`, exact OR inflected: for an inflected hit
 * the stem must appear and the full surface slice must DEINFLECT BACK to the
 * term (the same validate-don't-guess contract as the dictionary lookup).
 * Longest valid inflection wins (食べていた consumes the whole tail, not 食べて).
 */
export function findTermAll(hay: string, term: string): { span: Span; inflected: boolean }[] {
  const out: { span: Span; inflected: boolean }[] = [];
  if (term.length < 2) return out;
  // exact
  for (let i = hay.indexOf(term); i >= 0; i = hay.indexOf(term, i + 1)) {
    out.push({ span: { start: i, end: i + term.length }, inflected: false });
  }
  // inflected (verb-style tail only). Stem must be ≥2 chars: a 1-char kana
  // stem matches inside unrelated okurigana (いる's い finds 書いた's いた,
  // which legitimately deinflects to いる — a false morpheme boundary).
  if (CONJ_TAIL_RE.test(term)) {
    const stem = term.slice(0, -1);
    if (stem.length >= 2 || (stem.length === 1 && KANJI_RE.test(stem))) {
      for (let i = hay.indexOf(stem); i >= 0; i = hay.indexOf(stem, i + 1)) {
        const base = i + stem.length;
        if (hay.slice(i, base + 1) === term) continue; // exact already recorded
        let bestEnd = -1;
        for (let ext = 1; ext <= MAX_INFLECTION_EXT && base + ext <= hay.length; ext++) {
          const slice = hay.slice(i, base + ext);
          if (deinflect(slice).some((d) => d.term === term)) bestEnd = base + ext;
        }
        if (bestEnd > 0) out.push({ span: { start: i, end: bestEnd }, inflected: true });
      }
    }
  }
  out.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end);
  return out
    .filter((x) => !compoundPrefixed(hay, x.span))
    // drop spans fully contained in an earlier one (exact + its own inflection)
    .filter((x, idx, arr) => !arr.some((y, j) => j < idx && y.span.start <= x.span.start && y.span.end >= x.span.end));
}

/** Exact occurrences only, no minimum length — frame fixed material (ば, と)
 *  is legitimately one char; its precision comes from the slot constraints. */
function findExactAll(hay: string, term: string): { span: Span; inflected: boolean }[] {
  const out: { span: Span; inflected: boolean }[] = [];
  if (!term) return out;
  for (let i = hay.indexOf(term); i >= 0; i = hay.indexOf(term, i + 1)) {
    const span = { start: i, end: i + term.length };
    if (!compoundPrefixed(hay, span)) out.push({ span, inflected: false });
  }
  return out;
}

/**
 * Every part present IN ORDER, adjacent gaps ≤ maxGap and free of gapBlockRe
 * (🔵 gaps admit no punctuation at all — a collocation is one phrase; 🟠 gaps
 * are clause-scale but must not cross a sentence boundary). Tries each
 * occurrence of the first part as a start. Returns the covering span or null.
 */
function findOrderedParts(hay: string, parts: string[], maxGap: number, deinflectLast: boolean, gapOk: RegExp | ((gap: string) => boolean)): Span | null {
  const admits = typeof gapOk === 'function' ? gapOk : (g: string) => !gapOk.test(g);
  const firsts = findTermAll(hay, parts[0]);
  for (const f of firsts) {
    let cursor = f.span.end;
    let ok = true;
    let end = f.span.end;
    for (let pi = 1; pi < parts.length; pi++) {
      const last = pi === parts.length - 1;
      const occ = (last && deinflectLast ? findTermAll(hay, parts[pi]) : findTermAll(hay, parts[pi]).filter((o) => !o.inflected))
        .filter((o) => o.span.start >= cursor && o.span.start - cursor <= maxGap)
        .filter((o) => admits(hay.slice(cursor, o.span.start)));
      if (!occ.length) { ok = false; break; }
      cursor = occ[0].span.end;
      end = occ[0].span.end;
    }
    if (ok) return { start: f.span.start, end };
  }
  return null;
}

/** Trim the window to just-enough context around the span. */
function quoteAround(hay: string, span: Span, pad = 8): string {
  const s = Math.max(0, span.start - pad);
  const e = Math.min(hay.length, span.end + pad);
  return `${s > 0 ? '…' : ''}${hay.slice(s, e)}${e < hay.length ? '…' : ''}`;
}

const PUNCT_RE = /[、。！？!?・…‥「」『』()（）\s]/;
const SENTENCE_BREAK_RE = /[。！？!?]/;

/** ── per-class matchers (window text → candidate or null) ─────────────────── */

function matchCollocation(hay: string, e: SweepablePattern): { span: Span; confidence: number; matchKind: SweepMatchKind } | null {
  const parts = (e.payload.parts ?? []).map(norm).filter((p) => p.length >= 2);
  if (parts.length >= 2) {
    const span = findOrderedParts(hay, parts, 10, true, PUNCT_RE);
    if (!span) return null;
    const tight = span.end - span.start <= parts.join('').length + 4;
    return { span, confidence: tight ? 0.75 : 0.65, matchKind: 'components' };
  }
  const key = norm(e.key);
  const occ = findTermAll(hay, key);
  if (!occ.length) return null;
  return { span: occ[0].span, confidence: occ[0].inflected ? 0.7 : 0.75, matchKind: 'surface-inflected' };
}

function matchLink(hay: string, e: SweepablePattern): { span: Span; confidence: number; matchKind: SweepMatchKind } | null {
  const parts = (e.payload.parts ?? []).map(norm).filter((p) => p.length >= 2);
  if (parts.length < 2) return null;
  // A link that DECLARES sentence-crossing (payload.crossSentence) may do the
  // one thing its notation exists to say: cross a sentence boundary. Two facts
  // reviewed 2026-08-20 shape the rule:
  //  · the MINT (analysis-bundle) marks a crossing for ANY ender — 。．.!?！？ —
  //    and encodes them all as (。). So the declaration means "one sentence
  //    ender sits between the anchors", not "a 。 specifically"; a matcher that
  //    blocked ！？ made every ！-minted link stored-and-inert by construction.
  //  · "clause-scale" must be enforced, not asserted: the 30-char cap alone
  //    admits 4–5 short sentences. So each gap may contain AT MOST ONE ender —
  //    the boundary that was declared, and no more.
  // Callers hand this a TWO-LINE window (normed[i] + normed[i+1], seam
  // erased) — so on unpunctuated caption text a declared crossing behaves
  // like an ordinary link; the declaration only matters where enders exist.
  // Ordinary links keep the full ender guard unchanged (golden-pinned).
  if (e.payload.crossSentence) {
    const oneEnder = (gap: string): boolean => (gap.match(/[。！？!?．.]/g)?.length ?? 0) <= 1;
    const span = findOrderedParts(hay, parts, 30, true, oneEnder);
    if (!span) return null;
    return { span, confidence: 0.55, matchKind: 'link' };
  }
  const span = findOrderedParts(hay, parts, 30, true, SENTENCE_BREAK_RE);
  if (!span) return null;
  return { span, confidence: 0.6, matchKind: 'link' };
}

function matchFrame(hay: string, e: SweepablePattern): { span: Span; confidence: number; matchKind: SweepMatchKind } | null {
  const frame = norm(e.payload.frame ?? e.key);
  const segs = frame.split(/「?[○〇]{2,}」?/).map((s) => s.trim()).filter((s) => s.length >= 1);
  if (!segs.length || segs.join('').length < 3) return null;
  // A short single-segment frame (○○として) fires on every compositional use
  // of its particle — the holisticity test is invisible to a surface matcher,
  // so like the 🟢 bare lemma it is not sweepable. ≥4 chars of fixed material
  // (○○というわけだ) is enough shape to be worth proposing.
  if (segs.length === 1 && segs[0].length < 4) return null;
  if (segs.length === 1) {
    // frame is X<seg>Y — the seg must appear with real material on the slot side(s)
    const occ = findExactAll(hay, segs[0]);
    for (const o of occ) {
      const before = hay.slice(Math.max(0, o.span.start - 1), o.span.start);
      const after = hay.slice(o.span.end, o.span.end + 1);
      const slotFilled = (frame.startsWith(segs[0]) || (before && !PUNCT_RE.test(before)))
        && (frame.endsWith(segs[0]) || (after && !PUNCT_RE.test(after)));
      if (slotFilled) return { span: o.span, confidence: 0.6, matchKind: 'frame' };
    }
    return null;
  }
  // multi-segment: fixed material in order, slots BOUNDED and actually filled
  const firsts = findExactAll(hay, segs[0]);
  for (const f of firsts) {
    let cursor = f.span.end;
    let ok = true;
    let end = f.span.end;
    for (let si = 1; si < segs.length; si++) {
      const occ = findExactAll(hay, segs[si])
        .filter((o) => o.span.start - cursor >= 1 && o.span.start - cursor <= 12);
      if (!occ.length) { ok = false; break; }
      const slot = hay.slice(cursor, occ[0].span.start);
      if (PUNCT_RE.test(slot)) { ok = false; break; }   // slot must be one phrase, not a clause break
      cursor = occ[0].span.end;
      end = occ[0].span.end;
    }
    if (ok) return { span: { start: f.span.start, end }, confidence: 0.75, matchKind: 'frame' };
  }
  return null;
}

function matchHalo(hay: string, e: SweepablePattern): { span: Span; confidence: number; matchKind: SweepMatchKind } | null {
  const halo = norm(e.payload.halo ?? '');
  if (halo.length < 3) return null;                      // bare lemma = not sweepable
  const occ = findTermAll(hay, halo);
  if (!occ.length) return null;
  return { span: occ[0].span, confidence: occ[0].inflected ? 0.6 : 0.65, matchKind: 'halo' };
}

export type SweepablePattern = Pick<PatternEntry, 'class' | 'key' | 'keyKind' | 'payload'>;

/** Which classes this module can propose candidates for at all. */
export function sweepableClass(cls: PatternEntry['class']): boolean {
  return cls === 'collocation' || cls === 'skeletal' || cls === 'phrase_schema' || cls === 'rhet_collocation';
}

/**
 * The ✓✕ record steering the sweep: a pattern whose candidates keep getting
 * rejected is structurally coincidence-prone FOR THIS CATALOG ENTRY, so the
 * sweep stops proposing it — three strikes with no ratified sweep hit, and
 * each ratification (a swept attestation the user ✓'d: matchKind set, status
 * cleared) buys back five strikes. Purely derived from the entry's own
 * rejection/ratification history; no flag to maintain, and the pattern
 * un-mutes the moment enough ✓s outweigh the ✕s.
 */
export function sweepMuted(e: Pick<PatternEntry, 'attestations' | 'rejectedAtts' | 'standing'>): boolean {
  // A STANDING QUESTION (PatternEntry.standing — §27.0.2 / PHYSICS §5) never
  // mutes. The mute rule reads a ✕ as evidence the ENTRY is coincidence-prone,
  // which is right for a pattern you attested and wrong for a question you
  // filed: there, rejection is the normal case — you are fishing, and each ✕
  // prunes one candidate (isRejected already keeps it from returning) without
  // saying anything about the question. Muting would convert "no answer yet"
  // into "never ask again" — the exact inversion of §27 rule 4 (a hole is not
  // progress toward being closed). MAX_CANDIDATES_PER_FILE still bounds flood,
  // and abandoning the question is the user's verb, never this function's.
  if (e.standing) return false;
  const rejected = e.rejectedAtts?.length ?? 0;
  const ratifiedSweeps = e.attestations.filter((a) => a.matchKind && !a.status).length;
  return rejected >= 3 + 5 * ratifiedSweeps;
}

const MATCHERS: Record<string, (hay: string, e: SweepablePattern) => { span: Span; confidence: number; matchKind: SweepMatchKind } | null> = {
  collocation: matchCollocation,
  skeletal: matchLink,
  phrase_schema: matchFrame,
  rhet_collocation: matchHalo,
};

/** Max suggested candidates per pattern per transcript — passive growth, not flooding. */
export const MAX_CANDIDATES_PER_FILE = 3;

/**
 * Run the class-appropriate matcher over a transcript. Windows are pairs of
 * consecutive caption lines (captions continue mid-sentence across lines); a
 * hit must START in the first line of its window so it is reported once, at
 * the right timestamp.
 */
export function sweepEntry(e: SweepablePattern, lines: MatcherLine[]): SweepCandidate[] {
  const matcher = MATCHERS[e.class];
  if (!matcher) return [];
  const normed = lines.map((l) => norm(l.text));
  const out: SweepCandidate[] = [];
  // The dedup key. `tStartSec ?? null` was the whole key until 2026-08-20 —
  // and every line of an UNTIMESTAMPED medium (tweets, Kindle notes, prose)
  // keys null, so the second hit in the same document collided with the first
  // and at most ONE candidate ever survived per tweet/note/article, silently,
  // under a MAX_CANDIDATES_PER_FILE of 3. (medium-lines.ts even cites this
  // very expression as proof of medium-agnosticism — reading null is fine for
  // REPORTING; it was fatal as a dedup KEY.) Untimestamped lines now key by
  // their own index; timestamped dedup is unchanged.
  const seenT = new Set<number | string>();
  for (let i = 0; i < lines.length; i++) {
    const hay = normed[i] + (normed[i + 1] ?? '');
    if (!hay) continue;
    const m = matcher(hay, e);
    if (!m || m.span.start >= normed[i].length) continue;
    const t = lines[i].tStartSec ?? null;
    const key = t ?? `i${i}`;
    if (seenT.has(key)) continue;
    seenT.add(key);
    out.push({ tStartSec: t, quote: quoteAround(hay, m.span), confidence: m.confidence, matchKind: m.matchKind });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_CANDIDATES_PER_FILE);
}
