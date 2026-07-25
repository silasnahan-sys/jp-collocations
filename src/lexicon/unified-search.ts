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
  score: number;
}

const norm = (s: string): string => s.normalize('NFC').replace(/\s+/g, '').toLowerCase();

/**
 * Score one candidate surface against the (already normalized) needle.
 * 0 = no match. Exact 100, prefix 70, substring 45, plus a short bonus so
 * tighter surfaces sort above sprawling ones.
 */
function matchScore(surface: string, needle: string): number {
  if (!needle) return 1; // empty query → everything, ranked by metadata later
  const s = norm(surface);
  if (!s) return 0;
  if (s === needle) return 100;
  if (s.startsWith(needle)) return 70 + Math.max(0, 10 - (s.length - needle.length));
  if (s.includes(needle)) return 45 + Math.max(0, 8 - (s.length - needle.length));
  return 0;
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
    if (mode === 'quotes') {
      best = quoteScore(p.attestations.filter((a) => !a.status).map((a) => a.quote), needle);
    } else {
      const fields = [p.key, p.note, p.payload.lemma ?? '', p.payload.frame ?? '', ...(p.payload.parts ?? [])];
      for (const f of fields) best = Math.max(best, matchScore(f, needle));
      if (mode === 'prefix' && needle && best > 0 && best < 70) best = 0; // 前方一致: exact/prefix only
    }
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
      example: bestExample(p) ?? legacy?.exampleSentences?.[0],
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
        for (const f of fields) best = Math.max(best, matchScore(f ?? '', needle));
        if (mode === 'prefix' && needle && best > 0 && best < 70) best = 0;
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
