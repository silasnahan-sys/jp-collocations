/**
 * query-notation.ts — the 𝕏 query speaks the notation the catalog speaks.
 *
 * ## The report
 *
 * 「x dict doesnt seem to have the word proximity and patternistic matching i
 * asked for」 — and it did not. `XCorpusStore.matches` tested every required
 * term with `text.includes(term)`, so two terms only had to appear SOMEWHERE
 * in the same tweet. はず and まずは three sentences apart scored exactly like
 * はず(。)まずは in one breath. That is a bag of substrings, not a search for a
 * construction.
 *
 * Proximity did exist in the codebase — `relevance.ts` walks an ordered gap
 * with a 30-char window — but only to RANK a catalog pattern's parts after
 * retrieval. There was no way to ASK with it.
 *
 * ## The move: do not invent a query language
 *
 * The plugin already has a notation the hand writes every day, with one split
 * alphabet shared by derive and save: 〜 for a link between parts, ○○ for an
 * open slot. This module makes the SAME notation mean the same thing in the
 * search box, so a query is a pattern and not a string:
 *
 *   はず〜まずは        はず, then まずは, IN ORDER, within the window
 *   ○○として持っている  anything in the slot, the rest fixed
 *   以前の             a literal, exactly as before — nothing regresses
 *
 * Two consequences worth stating, because both are the difference between a
 * search that reads a construction and one that reads a string:
 *
 *  · ORDER IS MEANING. まずは〜はず is a different construction from
 *    はず〜まずは, so the walk is ordered and never a set-intersection.
 *  · THE WINDOW IS A KNOB, not a constant hidden in a matcher. A construction
 *    is clause-scale; the default says so and the caller may say otherwise.
 *
 * Pure — no store, no DOM — so the contract is pinned by golden/x-notation.mjs
 * rather than living inside a matcher nothing can reach.
 */

/** How far apart two parts may sit and still be one construction. */
export const DEFAULT_PROXIMITY = 30;

/** The slot mark, in every form the hand or the IME may produce. */
const SLOT_RE = /[○〇]{2,}/;
/** The link marks — the same alphabet derive and save share. */
const LINK_RE = /[〜~～→⇒]/;

export type TermKind = 'literal' | 'proximity' | 'frame';

export interface TermPattern {
  kind: TermKind;
  /** the term as written, kept for the empty state to quote back. */
  raw: string;
  /** proximity: the ordered parts. literal: the one string. */
  parts: string[];
  /** frame: the fixed material, split at the slots. */
  fixed?: string[];
  /** how far apart parts may sit (proximity), or a slot may stretch (frame). */
  window: number;
}

/**
 * Read one search term as a pattern.
 *
 * A term is notation only if the mark actually separates material — a bare 〜
 * or a trailing one is somebody typing, not a link, and it stays a literal so
 * the box never silently reinterprets a half-typed query.
 */
export function parseTerm(term: string, window = DEFAULT_PROXIMITY): TermPattern {
  const raw = term.trim();
  if (SLOT_RE.test(raw)) {
    const fixed = raw.split(SLOT_RE).map((s) => s.trim()).filter(Boolean);
    if (fixed.length) return { kind: 'frame', raw, parts: fixed, fixed, window };
  }
  if (LINK_RE.test(raw)) {
    const parts = raw.split(LINK_RE).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { kind: 'proximity', raw, parts, window };
  }
  return { kind: 'literal', raw, parts: [raw], window };
}

export interface TermHit {
  hit: boolean;
  /** where the whole construction sat, when it did. */
  span?: [number, number];
  /** total characters of intervening material — the 介在, and a ranking signal. */
  gap?: number;
}

/**
 * Walk `parts` through `text` in order, each within `window` of the last.
 *
 * Returns the FIRST satisfying walk rather than the best one. That is the
 * honest cost of not having a parser: a greedy walk can miss a tighter later
 * pairing, and the gap it reports is therefore an upper bound on the tightest
 * one. Stated here rather than discovered later — the alternative is
 * backtracking over every occurrence, which this corpus size does not earn.
 */
export function walkOrdered(
  text: string, parts: string[], window: number,
): TermHit {
  if (!parts.length) return { hit: false };
  let from = 0;
  let start = -1;
  let cursor = -1;
  let gap = 0;
  for (let i = 0; i < parts.length; i++) {
    const at = text.indexOf(parts[i], from);
    if (at === -1) return { hit: false };
    if (i === 0) { start = at; }
    else {
      const between = at - cursor;
      if (between > window) return { hit: false };
      gap += Math.max(0, between);
    }
    cursor = at + parts[i].length;
    from = cursor;
  }
  return { hit: true, span: [start, cursor], gap };
}

/** Does this text satisfy the pattern? */
export function termMatches(text: string, p: TermPattern): TermHit {
  switch (p.kind) {
    case 'literal': {
      const at = text.indexOf(p.parts[0]);
      return at === -1 ? { hit: false } : { hit: true, span: [at, at + p.parts[0].length], gap: 0 };
    }
    case 'proximity':
      return walkOrdered(text, p.parts, p.window);
    case 'frame':
      // A frame is an ordered walk over its fixed material — the slot IS the
      // gap. Same machinery, different reading of the same shape.
      return walkOrdered(text, p.fixed ?? p.parts, p.window);
  }
}

/**
 * The most selective LITERAL piece of a pattern — what the bigram index can
 * actually probe with.
 *
 * Load-bearing: the index is built over the tweet text, and 「はず〜まずは」
 * appears in no tweet ever written. Probing with the raw term would return an
 * empty candidate set and every notation query would answer 0件 while the
 * matcher below sat there working perfectly.
 */
export function probeOf(p: TermPattern): string {
  let best = '';
  for (const s of p.parts) if (s.length > best.length) best = s;
  return best;
}

/** One line the search box can print so the grammar is taught, not discovered. */
export function notationHint(p: TermPattern): string | null {
  switch (p.kind) {
    case 'proximity':
      return `${p.parts.join(' → ')} — この順で ${p.window}字以内`;
    case 'frame':
      return `${p.raw} — ○○は任意（${p.window}字まで）`;
    default:
      return null;
  }
}
