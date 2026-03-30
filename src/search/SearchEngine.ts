import type { CollocationEntry, SearchOptions, SearchResult } from "../types.ts";
import { CollocationStrength } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import { toHiragana, romajiToHiragana, similarity, normalizeJapanese, isJapanese } from "../utils/japanese.ts";
import { expandSearch } from "../utils/grammar.ts";

const STRENGTH_ORDER: Record<CollocationStrength, number> = {
  [CollocationStrength.Weak]: 1,
  [CollocationStrength.Moderate]: 2,
  [CollocationStrength.Strong]: 3,
  [CollocationStrength.Fixed]: 4,
};

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
      registerFilter,
      jlptFilter,
      boundaryTypeFilter,
      strengthFilter,
      minMiScore,
      includeNegativeExamples = true,
    } = options;

    const normalized = normalizeJapanese(query.trim());
    const hiraganaQuery = toHiragana(normalized);
    const romajiConverted = !isJapanese(normalized) && normalized.length > 0
      ? romajiToHiragana(normalized)
      : hiraganaQuery;

    const allTerms = new Set<string>([normalized, hiraganaQuery, romajiConverted]);
    for (const term of [normalized, hiraganaQuery]) {
      for (const variant of expandSearch(term)) {
        allTerms.add(variant);
      }
    }

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
    if (registerFilter && registerFilter.length > 0) {
      entries = entries.filter(e => e.register !== undefined && registerFilter.includes(e.register));
    }
    if (jlptFilter && jlptFilter.length > 0) {
      entries = entries.filter(e => e.jlptLevel !== undefined && jlptFilter.includes(e.jlptLevel));
    }
    if (boundaryTypeFilter && boundaryTypeFilter.length > 0) {
      entries = entries.filter(e => e.boundaryType !== undefined && boundaryTypeFilter.includes(e.boundaryType));
    }
    if (strengthFilter && strengthFilter.length > 0) {
      entries = entries.filter(e => e.strength !== undefined && strengthFilter.includes(e.strength));
    }
    if (minMiScore !== undefined) {
      entries = entries.filter(e => e.miScore !== undefined && e.miScore >= minMiScore);
    }

    if (!normalized) {
      return this.sortAndLimit(entries.map(e => ({ entry: e, score: e.frequency })), sortBy, sortDir, maxResults);
    }

    const results: SearchResult[] = [];

    for (const entry of entries) {
      const score = this.scoreEntry(entry, normalized, hiraganaQuery, romajiConverted, allTerms, wildcardRegex, fuzzy, includeNegativeExamples);
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
    fuzzy: boolean,
    includeNegativeExamples: boolean,
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

    if (includeNegativeExamples && entry.negativeExamples) {
      fields.push(...entry.negativeExamples);
    }

    if (entry.literalMeaning) fields.push(entry.literalMeaning);
    if (entry.figurativeMeaning) fields.push(entry.figurativeMeaning);
    if (entry.typicalContext) fields.push(entry.typicalContext);

    let best = 0;

    for (const field of fields) {
      if (!field) continue;
      const fieldNorm = normalizeJapanese(field);
      const fieldHira = toHiragana(fieldNorm);

      if (wildcardRegex && (wildcardRegex.test(fieldNorm) || wildcardRegex.test(fieldHira))) {
        best = Math.max(best, 90);
        continue;
      }

      for (const term of allTerms) {
        if (term && fieldNorm.includes(term)) {
          const boost = field === entry.headword || field === entry.fullPhrase ? 20 : 0;
          best = Math.max(best, 80 + boost);
        }
        if (term && fieldHira.includes(term)) {
          best = Math.max(best, 75);
        }
      }

      if (fuzzy && query.length >= 2) {
        for (const term of [query, hiraganaQuery, romajiConverted]) {
          if (!term || term.length < 2) continue;
          const sim = similarity(fieldNorm, term);
          if (sim > 0.5) best = Math.max(best, Math.round(sim * 60));
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
        case "miScore":
          cmp = (b.entry.miScore ?? 0) - (a.entry.miScore ?? 0);
          break;
        case "tScore":
          cmp = (b.entry.tScore ?? 0) - (a.entry.tScore ?? 0);
          break;
        case "logDice":
          cmp = (b.entry.logDice ?? 0) - (a.entry.logDice ?? 0);
          break;
        case "strength":
          cmp = (STRENGTH_ORDER[b.entry.strength ?? CollocationStrength.Moderate] ?? 0)
              - (STRENGTH_ORDER[a.entry.strength ?? CollocationStrength.Moderate] ?? 0);
          break;
        default:
          cmp = b.score - a.score;
      }
      if (cmp === 0) cmp = b.score - a.score;
      return sortDir === "asc" ? -cmp : cmp;
    });

    return results.slice(0, maxResults);
  }

  quickSearch(query: string, maxResults = 20): SearchResult[] {
    return this.search({ query, maxResults, fuzzy: true });
  }

  /** Bidirectional search: match query against both headword and collocate */
  bidirectionalSearch(query: string, maxResults = 50): SearchResult[] {
    return this.search({ query, maxResults, fuzzy: true });
  }

  /** Find all entries related to a given entry (semantic cluster) */
  clusterSearch(entryId: string, maxResults = 20): CollocationEntry[] {
    const entry = this.store.getById(entryId);
    if (!entry) return [];

    const seen = new Set<string>([entryId]);
    const results: CollocationEntry[] = [];

    // Related entries explicitly linked
    if (entry.relatedEntries) {
      for (const id of entry.relatedEntries) {
        const e = this.store.getById(id);
        if (e && !seen.has(id)) { seen.add(id); results.push(e); }
      }
    }

    // Synonym/antonym collocations
    for (const id of [...(entry.synonymCollocations ?? []), ...(entry.antonymCollocations ?? [])]) {
      const e = this.store.getById(id);
      if (e && !seen.has(id)) { seen.add(id); results.push(e); }
    }

    // Same headword
    const sameHeadword = this.store.getByHeadword(entry.headword);
    for (const e of sameHeadword) {
      if (!seen.has(e.id)) { seen.add(e.id); results.push(e); }
    }

    return results.slice(0, maxResults);
  }

  /** Negative collocation search: find entries that have negative examples */
  negativeSearch(query: string, maxResults = 20): SearchResult[] {
    const all = this.search({ query, maxResults: maxResults * 3, fuzzy: true, includeNegativeExamples: true });
    return all.filter(r => r.entry.negativeExamples && r.entry.negativeExamples.length > 0).slice(0, maxResults);
  }

  /** Pattern-based search (e.g. "名詞+を+動詞") */
  patternSearch(pattern: string, maxResults = 50): SearchResult[] {
    return this.search({ query: "", patternFilter: pattern, maxResults });
  }
}
