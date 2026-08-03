/**
 * unified-search.ts — the monokakido-style unified lexicon index (PURE).
 *
 * One search box over four strata, ranked so the user's OWN noticings win:
 *   1. catalog patterns (PatternStore) — the six note-types, keyed on the unit
 *   2. legacy collocations (CollocationStore)
 *   3. dictionary entries (resolved by the caller — deinflection lives there)
 *
 * The ranking is exact-key → prefix → substring, with catalog above lexicon
 * above dictionary at equal match quality. Autocomplete is the same ranking
 * truncated. No Obsidian imports; golden-tested (golden/lexicon.mjs).
 */

import type { PatternEntry, Attestation } from '../notes/pattern-store.ts';
import type { NoteClass } from '../notes/note-types.ts';
import type { CollocationEntry } from '../types.ts';
import { prepareQuery, scoreText, scoreFields, FieldCache, TIER, type MatchQuery } from '../search/match-japanese.ts';

export type UnifiedKind = 'pattern' | 'collocation';

export interface UnifiedEntry {
  id: string;
  kind: UnifiedKind;
  /** display surface (headword / key). */
  headword: string;
  reading?: string;
  /** note class for catalog entries (drives the color dot). */
  cls?: NoteClass;
  /** one-line meaning, if known. */
  gloss?: string;
  /** number of real located usages. */
  attestationCount: number;
  /** which sources back it (for the badges). */
  sources: Array<'yt' | 'x' | 'web' | 'manual'>;
  /** the backing object, for the detail view. */
  pattern?: PatternEntry;
  collocation?: CollocationEntry;
  /** catalog pattern + legacy collocation matched on the same surface: ONE row,
   *  the pattern's real attestations + the legacy entry's grammar notes. */
  merged?: boolean;
  /** one JUST-ENOUGH example line for the row — context is meaning. */
  example?: string;
  /**
   * The entry was found ONLY through its frozen 語法 profile — the query matched
   * a corpus collocate or a corpus example, not anything the user wrote.
   *
   * Kept apart because the two are different claims. "You have an entry called
   * this" and "a corpus you consulted once lists this under an entry you have"
   * must not arrive looking identical (§28 S3), and the second must never be
   * mistaken for your own noticing.
   */
  viaCorpus?: boolean;
  score: number;
}

const norm = (s: string): string => s.normalize('NFC').replace(/\s+/g, '').toLowerCase();

/**
 * Score one candidate surface against a prepared query, via the SHARED matcher.
 *
 * AUDIT §3: this used to be exact/prefix/includes over `norm()` alone — NFC +
 * strip-space + lowercase and nothing else. So `kaze` found 風 in the
 * CollocationView box and nothing here, and かぜ/カゼ behaved differently, on
 * the surface DESIGN §20 calls the product. `match-japanese.ts` carries the
 * kana folding, romaji and wildcard for both boxes now, on one tier scale, so
 * the two can no longer disagree about the same corpus.
 *
 * Grammar expansion stays OFF: catalog keys are already inflected fragments
 * (「んだったら〜なきゃ」), and conjugating them produces noise, not recall.
 */
function matchScore(surface: string, q: MatchQuery, mode: SearchMode, boost = 0): number {
  if (q.empty) return 1;                    // empty query → everything, ranked later
  if (!surface) return 0;
  return scoreText(surface, q, {
    boost,
    // Fuzzy is for the LEXICON box, where a half-remembered spelling is the
    // point. 前方一致 is a precise mode by definition and must not fuzz.
    fuzzy: mode !== 'prefix',
    mode: mode === 'prefix' ? 'prefix' : 'contains',
  });
}

// ── the corpus stratum (§22.7) ───────────────────────────────────────────────

/**
 * How many corpus surfaces one entry contributes to the index.
 *
 * A profile holds up to `MAX_FRAMES × FRAME_ITEMS` = 144 collocations, and this
 * function runs per entry per keystroke. The cap is not about storage, it is
 * about the search staying instant on a phone; frames arrive frequency-ranked
 * and items within a frame likewise, so the budget spends itself on the
 * collocations most worth finding.
 */
export const CORPUS_INDEX_CAP = 48;

/**
 * The corpus strings that should FIND an entry.
 *
 * §22.7 froze a whole collocational profile onto the entry and nothing indexed
 * it, so 144 measured collocates per word were visible in one box and
 * unreachable from the search that box sits behind. A profile you cannot search
 * is a reference book with no index.
 *
 * Round-robin across frames rather than the first N: 風＋助詞 alone would
 * otherwise eat the entire budget and 名詞＋の＋風 would be unsearchable, which
 * is the same failure the frames exist to prevent.
 */
export function corpusSurfaces(p: PatternEntry): string[] {
  const goho = p.payload.goho;
  if (!goho) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | undefined): void => {
    const t = (s ?? '').trim();
    if (!t || seen.has(t) || out.length >= CORPUS_INDEX_CAP) return;
    seen.add(t);
    out.push(t);
  };

  // The grammar itself is searchable — 「風＋助詞」 is a thing you might look for.
  for (const f of goho.frames ?? []) push(f.label);

  const frames = goho.frames ?? [];
  const deepest = frames.reduce((n, f) => Math.max(n, f.items.length), 0);
  for (let i = 0; i < deepest && out.length < CORPUS_INDEX_CAP; i++) {
    for (const f of frames) push(f.items[i]);
  }
  // Legacy flat profiles (frozen before frames existed) still reach the index.
  for (const c of goho.collocates ?? []) push(c);
  return out;
}

/** The corpus sentences 用例全文 mode should search. */
export function corpusQuotes(p: PatternEntry): string[] {
  const goho = p.payload.goho;
  if (!goho) return [];
  const sourced = goho.sourced?.map((e) => e.text) ?? [];
  return sourced.length ? sourced : goho.examples ?? [];
}

/**
 * Normalized corpus fields, cached per entry and invalidated by `updatedAt`.
 *
 * Module-level and `WeakMap`-backed (see `FieldCache`), so an entry's index dies
 * with the entry and a keystroke costs comparisons rather than 48 fresh
 * `normalizeJapanese` + `toHiragana` + bigram builds.
 */
const corpusCache = new FieldCache<PatternEntry>(corpusSurfaces, (p) => p.updatedAt);

/**
 * Fold a corpus hit into the band BELOW every real hit on the entry's own text.
 *
 * The rule this enforces, which is the §28 stratum order made arithmetic: **the
 * corpus can make an entry findable; it can never make it outrank an entry you
 * named yourself.** A word you wrote down is a noticing; a collocate a corpus
 * happens to list under it is not, and a search that let the second climb over
 * the first would be answering a different question than the one asked.
 *
 * Relative order WITHIN the corpus band is preserved, so an exact collocate
 * still beats a substring of one.
 */
function corpusBand(raw: number): number {
  if (raw <= 0) return 0;
  const ceiling = TIER.exact + 9;              // the most `scoreField` can return
  return Math.max(1, Math.round((Math.min(raw, ceiling) / ceiling) * (TIER.substring - 1)));
}

function sourcesOf(p: PatternEntry): UnifiedEntry['sources'] {
  const set = new Set<UnifiedEntry['sources'][number]>();
  for (const a of p.attestations) set.add(a.source);
  return [...set];
}

/**
 * The one example a compact row shows — the best CONFIRMED attestation
 * (anchored yt > yt > x > rest), or nothing. Never a suggested candidate.
 */
export function bestExample(p: PatternEntry): string | undefined {
  const rank = (a: Attestation): number =>
    a.source === 'yt' && a.anchorId ? 0 : a.source === 'yt' ? 1 : a.source === 'x' ? 2 : 3;
  const atts = p.attestations
    .filter((a) => !a.status && a.quote && a.quote.trim().length >= 3)
    .sort((a, b) => rank(a) - rank(b));
  return atts[0]?.quote.trim();
}

/**
 * Link the two worlds by surface: catalog pattern.key ⇔ legacy collocation
 * fullPhrase/headword (normalized equality). Returns patternId → legacy entry.
 */
export function linkLegacy(patterns: PatternEntry[], collocations: CollocationEntry[]): Map<string, CollocationEntry> {
  const byNorm = new Map<string, CollocationEntry>();
  for (const c of Array.isArray(collocations) ? collocations : []) {
    for (const s of [c.fullPhrase, c.headword]) {
      const k = s ? norm(s) : '';
      if (k && !byNorm.has(k)) byNorm.set(k, c);
    }
  }
  const out = new Map<string, CollocationEntry>();
  if (!byNorm.size) return out;
  for (const p of patterns) {
    const c = byNorm.get(norm(p.key));
    if (c) out.set(p.id, c);
  }
  return out;
}

/** monokakido search modes: 前方一致 / 含む / 用例全文 (§20.1). */
export type SearchMode = 'prefix' | 'contains' | 'quotes';

export interface UnifiedSearchInput {
  patterns: PatternEntry[];
  collocations: CollocationEntry[];
  /** class filter (catalog only); empty = all. */
  classes?: NoteClass[];
  /** restrict to entries with at least one attestation from these sources. */
  sources?: Array<'yt' | 'x' | 'web' | 'manual'>;
  query: string;
  /** default 'contains'. 'quotes' searches CONFIRMED attestation quotes
   *  (and legacy example sentences) instead of headword fields. */
  mode?: SearchMode;
  limit?: number;
}

/** Score an entry in quotes mode: hits over confirmed quotes only —
 *  suggestions must not make an entry findable by 用例 search. */
function quoteScore(quotes: string[], needle: string): number {
  if (!needle) return 1;
  let hits = 0;
  for (const q of quotes) if (norm(q).includes(needle)) hits++;
  return hits ? 50 + Math.min(20, hits * 5) : 0;
}

export function unifiedSearch(input: UnifiedSearchInput): UnifiedEntry[] {
  const needle = norm(input.query);
  // Folded ONCE per search; every field comparison below reuses it.
  const q = prepareQuery(input.query);
  const mode = input.mode ?? 'contains';
  const clsFilter = input.classes && input.classes.length ? new Set(input.classes) : null;
  const srcFilter = input.sources && input.sources.length ? new Set(input.sources) : null;
  const out: UnifiedEntry[] = [];

  // catalog ⇔ legacy links: a matched pair renders as ONE merged row
  const legacyOf = linkLegacy(input.patterns, input.collocations);
  const consumedLegacy = new Set([...legacyOf.values()].map((c) => c.id));

  // ── catalog patterns ──
  for (const p of input.patterns) {
    if (clsFilter && !clsFilter.has(p.class)) continue;
    if (srcFilter && !p.attestations.some((a) => srcFilter.has(a.source))) continue;
    // match against key, note, and payload strings (or, in 用例 mode, the
    // confirmed attestation quotes)
    let best = 0;
    let corpus = 0;
    if (mode === 'quotes') {
      best = quoteScore(p.attestations.filter((a) => !a.status).map((a) => a.quote), needle);
      // A corpus 用例 is a real sentence from a document the source named, so
      // 用例全文 must reach it — the mode's own promise is "search the example
      // text", and until now it searched only half of it.
      corpus = needle ? quoteScore(corpusQuotes(p), needle) : 0;
    } else {
      // 前方一致 is now enforced INSIDE the matcher (`mode:'prefix'` rejects
      // substring-only hits) rather than by discarding anything under 70 after
      // the fact — that post-filter also silently killed every wildcard hit.
      const fields = [p.key, p.note, p.payload.lemma ?? '', p.payload.frame ?? '', ...(p.payload.parts ?? [])];
      const boosts = [9, 2, 8, 6];
      for (let i = 0; i < fields.length; i++) {
        best = Math.max(best, matchScore(fields[i], q, mode, boosts[i] ?? 0));
      }
      // §22.7 — the frozen profile is part of what this entry knows, so it is
      // part of what can find it. Cached per entry; browse mode skips it since
      // everything already matches.
      corpus = q.empty ? 0 : scoreFields(corpusCache.fields(p), q, {
        fuzzy: mode !== 'prefix',
        mode: mode === 'prefix' ? 'prefix' : 'contains',
      });
    }
    // Only consulted when the entry's own text said nothing — see `corpusBand`.
    const viaCorpus = best === 0 && corpus > 0;
    if (viaCorpus) best = corpusBand(corpus);
    if (needle && best === 0) continue;
    // ranking/count use CONFIRMED attestations only — unratified sweep
    // candidates must not inflate an entry's standing.
    const confirmed = p.attestations.filter((a) => !a.status).length;
    const legacy = legacyOf.get(p.id);
    out.push({
      id: p.id,
      kind: 'pattern',
      headword: p.key,
      reading: legacy?.headwordReading || undefined,
      cls: p.class,
      gloss: p.payload.gloss || legacy?.notes || undefined,
      attestationCount: confirmed,
      sources: sourcesOf(p),
      pattern: p,
      collocation: legacy,
      merged: !!legacy,
      // A corpus-only hit with no example of its own shows the corpus's — the
      // row then says WHY it is here instead of sitting there unexplained.
      example: bestExample(p) ?? legacy?.exampleSentences?.[0]
        ?? (viaCorpus
          ? corpusQuotes(p).find((t) => norm(t).includes(needle)) ?? corpusQuotes(p)[0]
          : undefined),
      ...(viaCorpus ? { viaCorpus: true } : {}),
      // catalog stratum bonus (+6) + attestation weight so well-attested win ties
      score: best + 6 + Math.min(6, confirmed),
    });
  }

  // ── legacy collocations (only when not filtering to catalog classes) ──
  if (!clsFilter && !srcFilter && Array.isArray(input.collocations)) {
    for (const c of input.collocations) {
      if (consumedLegacy.has(c.id)) continue;             // already merged into its catalog row
      let best = 0;
      if (mode === 'quotes') {
        best = quoteScore(c.exampleSentences ?? [], needle);
      } else {
        const fields = [c.fullPhrase, c.headword, c.headwordReading, c.collocate, c.pattern];
        const boosts = [9, 9, 8, 4, 2];
        for (let i = 0; i < fields.length; i++) {
          best = Math.max(best, matchScore(fields[i] ?? '', q, mode, boosts[i]));
        }
      }
      if (needle && best === 0) continue;
      out.push({
        id: c.id,
        kind: 'collocation',
        headword: c.fullPhrase || c.headword,
        reading: c.headwordReading || undefined,
        gloss: c.notes || undefined,
        attestationCount: c.exampleSentences?.length ?? 0,
        sources: c.tags?.includes('x') ? ['x'] : [],
        collocation: c,
        example: c.exampleSentences?.[0],
        score: best,
      });
    }
  }

  out.sort((a, b) =>
    b.score - a.score ||
    b.attestationCount - a.attestationCount ||
    a.headword.length - b.headword.length ||
    a.headword.localeCompare(b.headword, 'ja'),
  );
  return out.slice(0, input.limit ?? 200);
}

/** Autocomplete suggestions — the top prefix/exact matches, headwords only. */
export function autocomplete(input: Omit<UnifiedSearchInput, 'limit'>, limit = 8): UnifiedEntry[] {
  const needle = norm(input.query);
  if (!needle) return [];
  return unifiedSearch({ ...input, limit: 400 })
    .filter((e) => {
      const s = norm(e.headword);
      return s === needle || s.startsWith(needle);
    })
    .slice(0, limit);
}
