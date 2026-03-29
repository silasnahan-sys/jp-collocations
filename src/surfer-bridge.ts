import { Notice } from "obsidian";
import type JPCollocationsPlugin from "./main.ts";
import type {
  SurferCollocationEntry,
  DiscourseContext,
  CollocationMatch,
  DiscourseCategory,
  DiscoursePosition,
  DiscourseStats,
} from "./surfer-types.ts";

export class SurferBridge {
  private entries: Map<string, SurferCollocationEntry> = new Map();
  private plugin: JPCollocationsPlugin;

  constructor(plugin: JPCollocationsPlugin) {
    this.plugin = plugin;
  }

  load(entries: SurferCollocationEntry[]): void {
    this.entries.clear();
    for (const e of entries) {
      this.entries.set(e.id, e);
    }
  }

  getAllEntriesMap(): Map<string, SurferCollocationEntry> {
    return this.entries;
  }

  private async persist(): Promise<void> {
    await this.plugin.saveData({
      ...this.plugin.settings,
      _surferEntries: [...this.entries.values()],
    });
  }

  // === Write operations ===

  async addEntryFromSurfer(entry: SurferCollocationEntry): Promise<void> {
    this.entries.set(entry.id, { ...entry });
    await this.persist();
    new Notice(`JP Collocations: saved "${entry.surface}"`);
  }

  async addDiscourseContext(collocationId: string, context: DiscourseContext): Promise<void> {
    const entry = this.entries.get(collocationId);
    if (!entry) return;
    const updated: SurferCollocationEntry = {
      ...entry,
      _discourseContexts: [...(entry._discourseContexts ?? []), context],
    };
    this.entries.set(collocationId, updated);
    await this.persist();
  }

  async saveExampleSentence(collocationId: string, sentence: string, source: string): Promise<void> {
    const entry = this.entries.get(collocationId);
    if (!entry) return;
    const updated: SurferCollocationEntry = {
      ...entry,
      exampleSentences: [
        ...(entry.exampleSentences ?? []),
        { text: sentence, source },
      ],
    };
    this.entries.set(collocationId, updated);
    await this.persist();
    new Notice(`JP Collocations: saved example for "${entry.surface}"`);
  }

  // === Read operations ===

  findCollocationsInText(text: string): CollocationMatch[] {
    if (!text) return [];
    const matches: CollocationMatch[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.surface) continue;
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const idx = text.indexOf(entry.surface, searchFrom);
        if (idx === -1) break;
        matches.push({
          entry,
          startOffset: idx,
          endOffset: idx + entry.surface.length,
          matchedSurface: entry.surface,
        });
        searchFrom = idx + 1;
      }
    }
    matches.sort((a, b) => a.startOffset - b.startOffset);
    return matches;
  }

  searchByDiscourseMarker(surface: string): SurferCollocationEntry[] {
    if (!surface) return [];
    const lower = surface.toLowerCase();
    return [...this.entries.values()].filter(
      e => e.surface?.toLowerCase().includes(lower)
    );
  }

  searchByCategory(category: DiscourseCategory): SurferCollocationEntry[] {
    return [...this.entries.values()].filter(e => e.discourseCategory === category);
  }

  getAllEntries(): SurferCollocationEntry[] {
    return [...this.entries.values()];
  }

  getDiscourseStats(): DiscourseStats {
    const allEntries = [...this.entries.values()];

    const byCategory = {} as Record<DiscourseCategory, number>;
    const byPosition = {} as Record<DiscoursePosition, number>;
    const coOccurrencePairs = new Map<string, number>();

    for (const entry of allEntries) {
      if (entry.discourseCategory) {
        byCategory[entry.discourseCategory] = (byCategory[entry.discourseCategory] ?? 0) + 1;
      }
      if (entry.discoursePosition) {
        byPosition[entry.discoursePosition] = (byPosition[entry.discoursePosition] ?? 0) + 1;
      }
      if (entry.coOccurrences) {
        for (const coId of entry.coOccurrences) {
          const pair: [string, string] = [entry.id, coId].sort() as [string, string];
          const key = pair.join('::');
          coOccurrencePairs.set(key, (coOccurrencePairs.get(key) ?? 0) + 1);
        }
      }
    }

    const topCoOccurrences = [...coOccurrencePairs.entries()]
      .map(([key, count]) => {
        const [a, b] = key.split('::');
        return { pair: [a, b] as [string, string], count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const topMarkers = allEntries
      .filter(e => e.surface)
      .sort((a, b) => (b.exampleSentences?.length ?? 0) - (a.exampleSentences?.length ?? 0))
      .slice(0, 20)
      .map(e => ({ surface: e.surface!, count: e.exampleSentences?.length ?? 0 }));

    return {
      totalEntries: allEntries.length,
      byCategory,
      byPosition,
      topCoOccurrences,
      topMarkers,
    };
  }
}
