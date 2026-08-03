import type { CollocationEntry, SearchOptions, SearchResult } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import { prepareQuery, scoreFields, FieldCache, type MatchQuery } from "./match-japanese.ts";
import { expandSearch } from "../utils/grammar.ts";

/**
 * Which fields of a legacy entry are searched, and how much each one means.
 *
 * Boosts stay inside a tier (0–9), so a tag substring can never outrank a
 * headword prefix — the old code added a flat +20 to headword hits, which let a
 * boosted substring (80+20) beat an exact match on any other field (also 80).
 */
const FIELDS = (e: CollocationEntry): string[] => [
  e.headword, e.headwordReading, e.fullPhrase, e.collocate, e.pattern,
  ...e.tags, ...e.exampleSentences,
];
const BOOSTS = [9, 8, 9, 4, 2];   // headword / reading / fullPhrase / collocate / pattern
const TAIL_BOOST = 0;             // tags + examples: findable, never ranked up

export class SearchEngine {
  private store: CollocationStore;

  /**
   * AUDIT §3(b) — normalization happens ONCE per entry, not per keystroke.
   * `scoreEntry` used to call `normalizeJapanese` + `toHiragana` for every
   * field of every entry on every keystroke; at 10k entries that alone was
   * most of the 505ms.
   */
  private cache = new FieldCache<CollocationEntry>(FIELDS, (e) => e.updatedAt);

  constructor(store: CollocationStore) {
    this.store = store;
  }

  search(options: SearchOptions): SearchResult[] {
    const {
      query,
      posFilter,
      tagFilter,
      sourceFilter,
      patternFilter,
      fuzzy = true,
      maxResults = 100,
      sortBy = "frequency",
      sortDir = "desc",
    } = options;

    // ONE matcher, shared with `unifiedSearch` (AUDIT §3). Kana folding,
    // romaji, wildcard and grammar expansion all live in `match-japanese.ts`
    // now, so both search boxes answer the same question the same way.
    // Grammar expansion is ON here: this store holds dictionary-form entries.
    const q = prepareQuery(query, { expand: expandSearch });

    let entries = this.store.getAll();

    // Apply filters
    if (posFilter && posFilter.length > 0) {
      entries = entries.filter(e => posFilter.includes(e.headwordPOS) || posFilter.includes(e.collocatePOS));
    }
    if (tagFilter && tagFilter.length > 0) {
      entries = entries.filter(e => tagFilter.some(t => e.tags.includes(t)));
    }
    if (sourceFilter && sourceFilter.length > 0) {
      entries = entries.filter(e => sourceFilter.includes(e.source));
    }
    if (patternFilter) {
      entries = entries.filter(e => e.pattern.includes(patternFilter));
    }

    // If no query, return filtered results sorted
    if (q.empty) {
      return this.sortAndLimit(entries.map(e => ({ entry: e, score: e.frequency })), sortBy, sortDir, maxResults);
    }

    const results: SearchResult[] = [];

    for (const entry of entries) {
      const score = this.scoreEntry(entry, q, fuzzy);
      if (score > 0) {
        results.push({ entry, score });
      }
    }

    return this.sortAndLimit(results, sortBy, sortDir, maxResults);
  }

  /**
   * Score one entry on the SHARED tier scale (match-japanese.ts).
   *
   * Was: per field, per term, a sliding-window Levenshtein over every
   * substring offset, with the field re-normalized on every keystroke.
   * scoreFields does the literal tiers first and gates the fuzzy pass behind
   * a bigram check; fields arrive already normalized from the cache.
   */
  private scoreEntry(entry: CollocationEntry, q: MatchQuery, fuzzy: boolean): number {
    const fields = this.cache.fields(entry);
    const boosts = fields.map((_, i) => (i < BOOSTS.length ? BOOSTS[i] : TAIL_BOOST));
    return scoreFields(fields, q, { fuzzy }, boosts);
  }

  private sortAndLimit(
    results: SearchResult[],
    sortBy: string,
    sortDir: string,
    maxResults: number
  ): SearchResult[] {
    results.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "headword":
          cmp = a.entry.headword.localeCompare(b.entry.headword, "ja");
          break;
        case "frequency":
          cmp = (b.entry.frequency - a.entry.frequency) || (b.score - a.score);
          break;
        case "createdAt":
          cmp = b.entry.createdAt - a.entry.createdAt;
          break;
        case "updatedAt":
          cmp = b.entry.updatedAt - a.entry.updatedAt;
          break;
        default:
          cmp = b.score - a.score;
      }
      // Secondary sort by score
      if (cmp === 0) cmp = b.score - a.score;
      return sortDir === "asc" ? -cmp : cmp;
    });

    return results.slice(0, maxResults);
  }

  quickSearch(query: string, maxResults = 20): SearchResult[] {
    return this.search({ query, maxResults, fuzzy: true });
  }
}
