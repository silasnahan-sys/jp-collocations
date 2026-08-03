/**
 * match-japanese.ts — ONE Japanese matcher, shared by every search surface.
 * PURE (no Obsidian). Golden: golden/match-japanese.mjs.
 *
 * ## Why this exists (AUDIT-2026-08-01 §3)
 *
 * The plugin had two search engines that disagreed about the same corpus:
 *
 * | surface | engine | matching |
 * |---|---|---|
 * | `CollocationView`, `SearchModal` | `SearchEngine` | normalize → kana-fold → romaji → grammar expansion → wildcard → Levenshtein |
 * | `LexiconPanel` (the product surface) | `unifiedSearch` | NFC + strip-space + lowercase, then exact / prefix / includes |
 *
 * So `kaze` found 風 in one box and nothing in the other; `かぜ` and `カゼ`
 * behaved differently; and the two ranked the same entries on incomparable
 * scales (80+20 boosts vs 100/70/45 tiers). For a tool whose promise is "type
 * it however it comes to mind and find it", the newer and more prominent
 * surface was the *less* capable matcher.
 *
 * ## And it has to scale
 *
 * `SearchEngine.scoreEntry` ran, per entry × per field × per term, a sliding
 * -window Levenshtein over **every substring offset**, and recomputed
 * `normalizeJapanese`/`toHiragana` for every field of every entry on every
 * keystroke. Measured: 16ms at 220 entries, 505ms at 10k, **2,533ms at 50k** —
 * and ONE Hyogen word is 22,558 collocations. Two fixes, both here:
 *
 *  - **`indexField` precomputes** norm/hira/bigrams once per field. Callers
 *    cache the index per entry (see `FieldCache`), so a keystroke costs
 *    comparisons, not normalizations.
 *  - **A bigram prefilter gates Levenshtein.** A field that shares no character
 *    bigram with the query cannot be a near-match, and the check is a handful of
 *    set lookups against an O(n·m) scan per offset.
 *
 * ## One scale
 *
 * Every surface must be able to merge and compare results, so there is exactly
 * one tier table:
 *
 *   100  exact (normalized)      70–80  prefix
 *    90  wildcard                45–53  substring
 *                                 1–40  fuzzy (always below a real substring hit)
 *
 * `boost` lifts a field that means more (a headword over a tag) WITHOUT
 * changing the tier, so a boosted substring can never outrank a real prefix.
 */

import { toHiragana, romajiToHiragana, similarity, normalizeJapanese, isJapanese } from '../utils/japanese.ts';

/**
 * Conjugation expansion is INJECTED, not imported.
 *
 * `utils/grammar.ts` pulls in the `PartOfSpeech` enum from `types.ts`, and this
 * module is loaded directly by the goldens through Node's strip-only TypeScript
 * loader, which rejects enums. Injection also states the real relationship: the
 * matcher does not know Japanese morphology, it knows how to compare strings —
 * the legacy lexicon supplies its own expander because its entries are
 * dictionary forms, and the catalog supplies none because its keys are already
 * inflected fragments.
 */
export type Expander = (term: string) => string[];

// ── tiers ────────────────────────────────────────────────────────────────────

export const TIER = {
  exact: 100,
  wildcard: 90,
  prefix: 70,
  substring: 45,
  /** fuzzy is scaled into 1..FUZZY_MAX and never reaches `substring`. */
  fuzzyMax: 40,
} as const;

/** Below this similarity a fuzzy candidate is noise, not a typo. */
const FUZZY_FLOOR = 0.72;

// ── query preparation ────────────────────────────────────────────────────────

export interface MatchQuery {
  raw: string;
  /** NFC + width/case folded (`normalizeJapanese`). */
  normalized: string;
  /** katakana folded to hiragana. */
  hiragana: string;
  /** romaji read as kana when the query has no Japanese in it (`kaze` → かぜ). */
  romaji: string;
  /** every surface worth testing: the three above + grammar expansions. */
  terms: string[];
  /** character bigrams of the query — the Levenshtein prefilter. */
  bigrams: Set<string>;
  wildcard: RegExp | null;
  /** true when there is nothing to match (browse, not search). */
  empty: boolean;
}

export function bigramsOf(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length === 1) { out.add(s); return out; }
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * Fold a raw query once. Callers do this per keystroke; everything else in this
 * module is comparison only.
 *
 * `grammar` expansion (走る → 走った/走って/走らない…) is opt-in because it is
 * only meaningful over a lexicon of dictionary forms — running it on the
 * catalog, whose keys are already inflected fragments, adds noise.
 */
export function prepareQuery(raw: string, opts: { expand?: Expander } = {}): MatchQuery {
  const normalized = normalizeJapanese((raw ?? '').trim());
  const hiragana = toHiragana(normalized);
  const romaji = normalized.length > 0 && !isJapanese(normalized)
    ? romajiToHiragana(normalized)
    : hiragana;

  const terms = new Set<string>();
  for (const t of [normalized, hiragana, romaji]) if (t) terms.add(t);
  if (opts.expand) {
    for (const base of [normalized, hiragana, romaji]) {
      if (!base) continue;
      for (const v of opts.expand(base)) if (v) terms.add(v);
    }
  }

  // `*` → `.*`, `?` → `.`; everything else escaped, or a query containing `(`
  // throws instead of searching.
  const hasWild = /[*?]/.test(normalized);
  const wildcard = hasWild
    ? new RegExp('^' + normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
    : null;

  return {
    raw: raw ?? '',
    normalized, hiragana, romaji,
    terms: [...terms],
    bigrams: bigramsOf(hiragana || normalized),
    wildcard,
    empty: normalized.length === 0,
  };
}

// ── field preparation ────────────────────────────────────────────────────────

export interface FieldIndex {
  text: string;
  norm: string;
  hira: string;
  bigrams: Set<string>;
}

export function indexField(text: string): FieldIndex {
  const norm = normalizeJapanese(text ?? '');
  const hira = toHiragana(norm);
  return { text: text ?? '', norm, hira, bigrams: bigramsOf(hira) };
}

/**
 * Per-object field cache, keyed on identity and invalidated by a stamp.
 *
 * This is the fix for "normalize every field of every entry on every
 * keystroke". A `WeakMap` so a deleted entry's index is collected with it —
 * no eviction policy to get wrong, no unbounded Map keyed on ids that outlive
 * their rows.
 */
export class FieldCache<T extends object> {
  private map = new WeakMap<T, { stamp: number; fields: FieldIndex[] }>();
  private extract: (item: T) => string[];
  private stampOf: (item: T) => number;

  // NB: written as plain assignments, not constructor parameter properties —
  // the goldens load this file through Node's strip-only TypeScript loader,
  // which rejects `constructor(private x: T)`.
  constructor(
    extract: (item: T) => string[],
    /** anything that changes when the item's text changes (usually updatedAt). */
    stampOf: (item: T) => number,
  ) {
    this.extract = extract;
    this.stampOf = stampOf;
  }

  fields(item: T): FieldIndex[] {
    const stamp = this.stampOf(item);
    const hit = this.map.get(item);
    if (hit && hit.stamp === stamp) return hit.fields;
    const fields = this.extract(item).filter(Boolean).map(indexField);
    this.map.set(item, { stamp, fields });
    return fields;
  }
}

// ── scoring ──────────────────────────────────────────────────────────────────

export interface ScoreOpts {
  /** added to a hit's tier without crossing into the next one (0–9). */
  boost?: number;
  /** run the fuzzy pass at all. Off for large corpora / prefix mode. */
  fuzzy?: boolean;
  /** 'prefix' rejects substring-only hits (monokakido 前方一致). */
  mode?: 'prefix' | 'contains';
}

/** Shorter surfaces sort above sprawling ones at the same tier. */
const tightness = (fieldLen: number, needleLen: number, max: number): number =>
  Math.max(0, max - (fieldLen - needleLen));

/**
 * Score ONE prepared field against a prepared query. 0 = no match.
 *
 * Order matters and is the tier table: exact, wildcard, prefix, substring, and
 * only then fuzzy — so a typo-tolerant hit can never outrank a literal one.
 */
export function scoreField(f: FieldIndex, q: MatchQuery, opts: ScoreOpts = {}): number {
  if (q.empty) return 1;                       // browse: everything, ranked elsewhere
  if (!f.norm) return 0;
  const boost = Math.min(9, Math.max(0, opts.boost ?? 0));

  if (q.wildcard && (q.wildcard.test(f.norm) || q.wildcard.test(f.hira))) {
    return TIER.wildcard + boost;
  }

  let best = 0;
  for (const term of q.terms) {
    if (!term) continue;
    // Compare on BOTH the normalized and the kana-folded field, which is what
    // makes かぜ/カゼ/kaze reach the same row.
    for (const hay of (f.hira === f.norm ? [f.norm] : [f.norm, f.hira])) {
      if (hay === term) return TIER.exact + boost;         // nothing beats exact
      if (hay.startsWith(term)) {
        best = Math.max(best, TIER.prefix + tightness(hay.length, term.length, 9) + boost);
      } else if (opts.mode !== 'prefix' && hay.includes(term)) {
        best = Math.max(best, TIER.substring + tightness(hay.length, term.length, 8) + boost);
      }
    }
  }
  if (best) return best;
  if (!opts.fuzzy || opts.mode === 'prefix') return 0;

  // ── fuzzy, behind the bigram gate ──
  // A field sharing no bigram with the query cannot be within a small edit
  // distance of it, so this skips the O(n·m)-per-offset scan for the vast
  // majority of entries — the difference between 2.5s and a few ms at 50k.
  let shares = false;
  for (const b of q.bigrams) { if (f.bigrams.has(b)) { shares = true; break; } }
  if (!shares) return 0;

  const needle = q.hiragana || q.normalized;
  if (needle.length < 2) return 0;
  let sim = similarity(f.hira, needle);
  if (f.hira.length >= needle.length) {
    // window the needle across the field so a match inside a long phrase counts
    for (let i = 0; i + needle.length <= f.hira.length; i++) {
      const s = similarity(f.hira.slice(i, i + needle.length), needle);
      if (s > sim) sim = s;
      if (sim >= 0.999) break;
    }
  }
  return sim >= FUZZY_FLOOR ? Math.max(1, Math.round(sim * TIER.fuzzyMax)) + boost : 0;
}

/** Best score across several fields. `boosts` is parallel to `fields`. */
export function scoreFields(fields: FieldIndex[], q: MatchQuery, opts: ScoreOpts = {}, boosts?: number[]): number {
  let best = 0;
  for (let i = 0; i < fields.length; i++) {
    const s = scoreField(fields[i], q, boosts ? { ...opts, boost: boosts[i] } : opts);
    if (s > best) best = s;
    if (best >= TIER.exact) break;
  }
  return best;
}

/** Convenience for callers with raw strings and no cache (cold paths only). */
export function scoreText(text: string, q: MatchQuery, opts: ScoreOpts = {}): number {
  return scoreField(indexField(text), q, opts);
}
