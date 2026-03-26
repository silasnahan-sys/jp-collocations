import type { CollocationEntry, SearchOptions, SearchResult } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import { toHiragana, romajiToHiragana, similarity, normalizeJapanese, isJapanese } from "../utils/japanese.ts";
import { expandSearch } from "../utils/grammar.ts";

export class SearchEngine {
  private store: CollocationStore;

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

    const normalized = normalizeJapanese(query.trim());
    const hiraganaQuery = toHiragana(normalized);
    // If query is romaji, convert to hiragana for matching
    const romajiConverted = !isJapanese(normalized) && normalized.length > 0
      ? romajiToHiragana(normalized)
      : hiraganaQuery;

    const allTerms = new Set<string>([normalized, hiraganaQuery, romajiConverted]);
    // Grammar expansion
    for (const term of [normalized, hiraganaQuery]) {
      for (const variant of expandSearch(term)) {
        allTerms.add(variant);
      }
    }

    // Wildcard conversion: * → .*, ? → .
    const wildcardRegex = normalized.includes("*") || normalized.includes("?")
      ? new RegExp(
          "^" + normalized.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
          "i"
        )
      : null;

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
    if (!normalized) {
      return this.sortAndLimit(entries.map(e => ({ entry: e, score: e.frequency })), sortBy, sortDir, maxResults);
    }

    const results: SearchResult[] = [];

    for (const entry of entries) {
      const score = this.scoreEntry(entry, normalized, hiraganaQuery, romajiConverted, allTerms, wildcardRegex, fuzzy);
      if (score > 0) {
        results.push({ entry, score });
      }
    }

    return this.sortAndLimit(results, sortBy, sortDir, maxResults);
  }

  private scoreEntry(
    entry: CollocationEntry,
    query: string,
    hiraganaQuery: string,
    romajiConverted: string,
    allTerms: Set<string>,
    wildcardRegex: RegExp | null,
    fuzzy: boolean
  ): number {
    const fields = [
      entry.headword,
      entry.headwordReading,
      entry.collocate,
      entry.fullPhrase,
      entry.pattern,
      ...entry.tags,
      ...entry.exampleSentences,
    ];

    let best = 0;

    for (const field of fields) {
      if (!field) continue;
      const fieldNorm = normalizeJapanese(field);
      const fieldHira = toHiragana(fieldNorm);

      // Wildcard
      if (wildcardRegex && (wildcardRegex.test(fieldNorm) || wildcardRegex.test(fieldHira))) {
        best = Math.max(best, 90);
        continue;
      }

      // Exact match
      for (const term of allTerms) {
        if (term && fieldNorm.includes(term)) {
          // Boost for headword exact match
          const boost = field === entry.headword || field === entry.fullPhrase ? 20 : 0;
          best = Math.max(best, 80 + boost);
        }
        if (term && fieldHira.includes(term)) {
          best = Math.max(best, 75);
        }
      }

      // Fuzzy
      if (fuzzy && query.length >= 2) {
        for (const term of [query, hiraganaQuery, romajiConverted]) {
          if (!term || term.length < 2) continue;
          const sim = similarity(fieldNorm, term);
          if (sim > 0.5) best = Math.max(best, Math.round(sim * 60));
          // substring fuzzy
          if (fieldNorm.length >= term.length) {
            for (let i = 0; i <= fieldNorm.length - term.length; i++) {
              const sub = fieldNorm.slice(i, i + term.length);
              const s = similarity(sub, term);
              if (s > 0.7) best = Math.max(best, Math.round(s * 65));
            }
          }
        }
      }
    }

    return best;
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
