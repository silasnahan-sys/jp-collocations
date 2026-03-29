import type { YomitanEntry, ImportedDictionary } from "./types.ts";
import type { YomitanStore } from "./YomitanStore.ts";
import { MAX_SUGGESTIONS } from "./constants.ts";

export interface SearchResultGroup {
  dictionaryTitle: string;
  entries: YomitanEntry[];
}

export class YomitanSearchEngine {
  constructor(private store: YomitanStore) {}

  async search(
    query: string,
    enabledDicts: ImportedDictionary[]
  ): Promise<SearchResultGroup[]> {
    if (!query.trim()) return [];
    const titles = enabledDicts.filter(d => d.enabled).map(d => d.title);
    const entries = await this.store.searchEntries(query.trim(), titles);

    // Group by dictionary, maintain dict order
    const groups = new Map<string, YomitanEntry[]>();
    for (const title of titles) groups.set(title, []);
    for (const entry of entries) {
      const g = groups.get(entry.dictionaryTitle);
      if (g) g.push(entry);
    }

    return Array.from(groups.entries())
      .filter(([, e]) => e.length > 0)
      .map(([dictionaryTitle, entries]) => ({ dictionaryTitle, entries }));
  }

  async suggest(query: string, enabledDicts: ImportedDictionary[]): Promise<string[]> {
    if (!query.trim()) return [];
    const titles = enabledDicts.filter(d => d.enabled).map(d => d.title);
    const entries = await this.store.searchEntries(query.trim(), titles);
    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const entry of entries) {
      if (!seen.has(entry.expression)) {
        seen.add(entry.expression);
        suggestions.push(entry.expression);
        if (suggestions.length >= MAX_SUGGESTIONS) break;
      }
    }
    return suggestions;
  }
}
