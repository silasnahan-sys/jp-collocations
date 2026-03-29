// ─── Yomitan Search Engine ───────────────────────────────────────────────────
// Handles multi-dictionary search across monolingual and bilingual dicts.
// Supports Japanese, English, and mixed-language queries.

import type { YomitanSearchOptions, YomitanSearchResult, TermEntry, DictionaryMeta } from "./types.ts";
import type { YomitanStore } from "./YomitanStore.ts";

/** Detect if a string is primarily Latin/English (as opposed to Japanese) */
function isEnglishQuery(query: string): boolean {
  const latinCount = (query.match(/[a-zA-Z]/g) ?? []).length;
  const japaneseCount = (query.match(/[\u3040-\u30FF\u4E00-\u9FFF\uFF00-\uFFEF]/g) ?? []).length;
  return japaneseCount === 0 && latinCount > 0;
}

/** Normalise query for comparison */
function normalise(s: string): string {
  return s.toLowerCase().trim().normalize("NFKC");
}

/** Simple relevance scoring */
function scoreEntry(entry: TermEntry, query: string, normQuery: string): number {
  const normTerm = normalise(entry.term);
  const normReading = normalise(entry.reading ?? "");

  if (normTerm === normQuery) return 100;
  if (normReading === normQuery) return 95;
  if (normTerm.startsWith(normQuery)) return 80;
  if (normReading.startsWith(normQuery)) return 75;
  if (normTerm.includes(normQuery)) return 60;
  if (normReading.includes(normQuery)) return 55;

  // For English queries, also check definition text
  if (isEnglishQuery(query)) {
    const defText = entry.definitions
      .flatMap(d => d.content)
      .filter(c => c.type === "text")
      .map(c => normalise(c.text ?? ""))
      .join(" ");
    if (defText.includes(normQuery)) return 40;
  }

  return 0;
}

export class YomitanSearchEngine {
  constructor(private readonly store: YomitanStore) {}

  /**
   * Search across all imported dictionaries.
   * - mode "all": search everywhere
   * - mode "monolingual": only ja-language dicts
   * - mode "bilingual": only en-ja / ja-en dicts
   */
  async search(options: YomitanSearchOptions): Promise<YomitanSearchResult[]> {
    const {
      query,
      mode = "all",
      maxResults = 50,
      dictionaries,
    } = options;

    if (!query.trim()) return [];

    await this.store.open();

    const normQuery = normalise(query);
    const english = isEnglishQuery(query);

    // Collect raw results from the store
    let termResults: TermEntry[] = [];

    if (english) {
      // English query: prefix-search on term (headword) and reading
      const [byTerm, byReading] = await Promise.all([
        this.store.prefixSearch(query, maxResults * 2),
        this.store.prefixSearchReading(query, maxResults * 2),
      ]);
      const seen = new Set<string>();
      for (const e of [...byTerm, ...byReading]) {
        const key = `${e.dictionary}::${e.term}::${e.reading}`;
        if (!seen.has(key)) { seen.add(key); termResults.push(e); }
      }
    } else {
      // Japanese query: exact + prefix search
      const [exact, byTerm, byReading] = await Promise.all([
        this.store.lookupTerm(query),
        this.store.prefixSearch(query, maxResults * 2),
        this.store.prefixSearchReading(query, maxResults * 2),
      ]);
      const seen = new Set<string>();
      for (const e of [...exact, ...byTerm, ...byReading]) {
        const key = `${e.dictionary}::${e.term}::${e.reading}`;
        if (!seen.has(key)) { seen.add(key); termResults.push(e); }
      }
    }

    // Filter by mode / dict allowlist
    const importedTitles = new Set(this.store.importedDictionaries.map(d => d.index.title));
    const metaByTitle = new Map<string, DictionaryMeta>();
    for (const imported of this.store.importedDictionaries) {
      metaByTitle.set(imported.index.title, imported.meta);
    }

    termResults = termResults.filter(e => {
      if (!importedTitles.has(e.dictionary)) return false;
      if (dictionaries && !dictionaries.includes(e.dictionary)) return false;

      if (mode !== "all") {
        const meta = metaByTitle.get(e.dictionary);
        if (!meta) return false;
        const isBilingual = meta.language === "en-ja" || meta.language === "ja-en";
        if (mode === "bilingual" && !isBilingual) return false;
        if (mode === "monolingual" && isBilingual) return false;
      }

      return true;
    });

    // Score and sort
    const scored: YomitanSearchResult[] = termResults.map(entry => ({
      entry,
      score: scoreEntry(entry, query, normQuery),
      meta: metaByTitle.get(entry.dictionary),
    }));

    // Sort: monolingual first, then bilingual; within each group sort by score desc
    scored.sort((a, b) => {
      const aIsBI = a.meta?.language === "en-ja" || a.meta?.language === "ja-en";
      const bIsBI = b.meta?.language === "en-ja" || b.meta?.language === "ja-en";
      if (aIsBI !== bIsBI) return aIsBI ? 1 : -1; // monolingual first
      return b.score - a.score;
    });

    return scored.slice(0, maxResults);
  }

  /**
   * Quick suggestions for the search bar (lightweight prefix only).
   */
  async suggest(query: string, maxResults = 10): Promise<YomitanSearchResult[]> {
    return this.search({ query, maxResults, mode: "all" });
  }
}
