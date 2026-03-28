import type { App } from "obsidian";
import type {
  DiscourseContext,
  DiscourseIndex,
  DiscourseChunkRecord,
  DiscourseCategory,
  SurferCollocationEntry,
} from "../types.ts";
import type { CollocationStore } from "./CollocationStore.ts";
import { CollocationSource, PartOfSpeech } from "../types.ts";

const EMPTY_INDEX: DiscourseIndex = {
  chunks: [],
  markerToChunkIds: {},
  categoryToChunkIds: {},
  collocationToChunkIds: {},
};

export class DiscourseStore {
  private app: App;
  private collocationStore: CollocationStore;
  private indexPath: string;
  private index: DiscourseIndex = { ...EMPTY_INDEX, chunks: [] };
  private maxContextsPerCollocation: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    app: App,
    collocationStore: CollocationStore,
    indexPath: string,
    maxContextsPerCollocation = 50
  ) {
    this.app = app;
    this.collocationStore = collocationStore;
    this.indexPath = indexPath;
    this.maxContextsPerCollocation = maxContextsPerCollocation;
  }

  async load(): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(this.indexPath);
      if (exists) {
        const raw = await this.app.vault.adapter.read(this.indexPath);
        this.index = JSON.parse(raw) as DiscourseIndex;
        // Ensure all required fields are present (migration safety)
        if (!this.index.chunks) this.index.chunks = [];
        if (!this.index.markerToChunkIds) this.index.markerToChunkIds = {};
        if (!this.index.categoryToChunkIds) this.index.categoryToChunkIds = {};
        if (!this.index.collocationToChunkIds) this.index.collocationToChunkIds = {};
      }
    } catch (err) {
      console.error("[jp-collocations] Failed to load discourse index:", err);
      this.index = { chunks: [], markerToChunkIds: {}, categoryToChunkIds: {}, collocationToChunkIds: {} };
    }
  }

  async save(): Promise<void> {
    const data = JSON.stringify(this.index, null, 2);
    await this.app.vault.adapter.write(this.indexPath, data);
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save().catch(console.error);
    }, 1000);
  }

  private generateChunkId(): string {
    return `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Returns all discourse contexts stored for a given collocation ID.
   */
  getContextsForCollocation(collocationId: string): DiscourseContext[] {
    const chunkIds = this.index.collocationToChunkIds[collocationId] ?? [];
    return chunkIds
      .map(cid => this.index.chunks.find(c => c.id === cid))
      .filter((c): c is DiscourseChunkRecord => c !== undefined)
      .map(c => c.context)
      .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime());
  }

  /**
   * Attach a discourse context to a collocation entry, deduplicating on
   * chunkText + source.file.
   */
  async addContext(collocationId: string, context: DiscourseContext, maxContexts: number): Promise<void> {
    const existing = this.getContextsForCollocation(collocationId);

    // Deduplication check
    const isDuplicate = existing.some(
      c => c.chunkText === context.chunkText && c.source.file === context.source.file
    );
    if (isDuplicate) return;

    // Enforce max-contexts limit
    const chunkIds = this.index.collocationToChunkIds[collocationId] ?? [];
    if (chunkIds.length >= maxContexts) {
      // Remove the oldest chunk
      const oldest = chunkIds[0];
      this.removeChunk(oldest, collocationId);
    }

    const record: DiscourseChunkRecord = {
      id: this.generateChunkId(),
      collocationId,
      context,
    };

    this.index.chunks.push(record);

    // Update collocation index
    if (!this.index.collocationToChunkIds[collocationId]) {
      this.index.collocationToChunkIds[collocationId] = [];
    }
    this.index.collocationToChunkIds[collocationId].push(record.id);

    // Update marker index
    for (const marker of context.markers) {
      if (!this.index.markerToChunkIds[marker.surface]) {
        this.index.markerToChunkIds[marker.surface] = [];
      }
      if (!this.index.markerToChunkIds[marker.surface].includes(record.id)) {
        this.index.markerToChunkIds[marker.surface].push(record.id);
      }
    }

    // Update category index
    for (const marker of context.markers) {
      const cat = marker.category as string;
      if (!this.index.categoryToChunkIds[cat]) {
        this.index.categoryToChunkIds[cat] = [];
      }
      if (!this.index.categoryToChunkIds[cat].includes(record.id)) {
        this.index.categoryToChunkIds[cat].push(record.id);
      }
    }

    this.scheduleSave();
  }

  private removeChunk(chunkId: string, collocationId: string): void {
    const chunkIndex = this.index.chunks.findIndex(c => c.id === chunkId);
    if (chunkIndex === -1) return;
    const record = this.index.chunks[chunkIndex];
    this.index.chunks.splice(chunkIndex, 1);

    // Remove from collocation index
    const cIds = this.index.collocationToChunkIds[collocationId];
    if (cIds) {
      const idx = cIds.indexOf(chunkId);
      if (idx !== -1) cIds.splice(idx, 1);
    }

    // Remove from marker index
    for (const marker of record.context.markers) {
      const mIds = this.index.markerToChunkIds[marker.surface];
      if (mIds) {
        const idx = mIds.indexOf(chunkId);
        if (idx !== -1) mIds.splice(idx, 1);
      }
    }

    // Remove from category index
    for (const marker of record.context.markers) {
      const catIds = this.index.categoryToChunkIds[marker.category];
      if (catIds) {
        const idx = catIds.indexOf(chunkId);
        if (idx !== -1) catIds.splice(idx, 1);
      }
    }
  }

  /**
   * Returns SurferCollocationEntry objects for all collocations whose stored
   * contexts contain the given marker surface text.
   */
  getEntriesByMarker(markerSurface: string): SurferCollocationEntry[] {
    const chunkIds = this.index.markerToChunkIds[markerSurface] ?? [];
    return this.buildEntriesFromChunkIds(chunkIds);
  }

  /**
   * Returns SurferCollocationEntry objects for all collocations whose stored
   * contexts have been tagged with the given category.
   */
  getEntriesByCategory(category: DiscourseCategory): SurferCollocationEntry[] {
    const chunkIds = this.index.categoryToChunkIds[category as string] ?? [];
    return this.buildEntriesFromChunkIds(chunkIds);
  }

  private buildEntriesFromChunkIds(chunkIds: string[]): SurferCollocationEntry[] {
    // Collect unique collocation IDs
    const collocationIds = new Set<string>();
    for (const cid of chunkIds) {
      const record = this.index.chunks.find(c => c.id === cid);
      if (record) collocationIds.add(record.collocationId);
    }

    const results: SurferCollocationEntry[] = [];
    for (const colId of collocationIds) {
      const entry = this.collocationStore.getById(colId);
      if (!entry) continue;
      const contexts = this.getContextsForCollocation(colId);
      results.push({
        expression: entry.fullPhrase || entry.headword,
        reading: entry.headwordReading || undefined,
        meaning: entry.notes || undefined,
        exampleSentence: entry.exampleSentences[0],
        exampleSource: undefined,
        discourseContexts: contexts,
        tags: entry.tags,
      });
    }
    return results;
  }

  /**
   * Returns discourse statistics aggregated across all stored contexts.
   */
  getStats(): {
    markerFrequency: Record<string, number>;
    categoryBreakdown: Record<DiscourseCategory, number>;
    totalContexts: number;
  } {
    const markerFrequency: Record<string, number> = {};
    const categoryBreakdown: Partial<Record<DiscourseCategory, number>> = {};

    for (const [surface, ids] of Object.entries(this.index.markerToChunkIds)) {
      markerFrequency[surface] = ids.length;
    }

    for (const [cat, ids] of Object.entries(this.index.categoryToChunkIds)) {
      categoryBreakdown[cat as DiscourseCategory] = ids.length;
    }

    return {
      markerFrequency,
      categoryBreakdown: categoryBreakdown as Record<DiscourseCategory, number>,
      totalContexts: this.index.chunks.length,
    };
  }

  /**
   * Rebuilds the in-memory index from the chunks array (useful after load).
   * Called automatically after load().
   */
  rebuildIndex(): void {
    this.index.markerToChunkIds = {};
    this.index.categoryToChunkIds = {};
    this.index.collocationToChunkIds = {};

    for (const record of this.index.chunks) {
      // collocation index
      if (!this.index.collocationToChunkIds[record.collocationId]) {
        this.index.collocationToChunkIds[record.collocationId] = [];
      }
      if (!this.index.collocationToChunkIds[record.collocationId].includes(record.id)) {
        this.index.collocationToChunkIds[record.collocationId].push(record.id);
      }

      for (const marker of record.context.markers) {
        // marker index
        if (!this.index.markerToChunkIds[marker.surface]) {
          this.index.markerToChunkIds[marker.surface] = [];
        }
        if (!this.index.markerToChunkIds[marker.surface].includes(record.id)) {
          this.index.markerToChunkIds[marker.surface].push(record.id);
        }

        // category index
        const cat = marker.category as string;
        if (!this.index.categoryToChunkIds[cat]) {
          this.index.categoryToChunkIds[cat] = [];
        }
        if (!this.index.categoryToChunkIds[cat].includes(record.id)) {
          this.index.categoryToChunkIds[cat].push(record.id);
        }
      }
    }
  }

  /** Returns all stored SurferCollocationEntry objects by assembling them from
   * the collocation store combined with their discourse contexts. */
  getAllEntries(): SurferCollocationEntry[] {
    const allCollocationEntries = this.collocationStore.getAll();
    return allCollocationEntries.map(e => {
      const contexts = this.getContextsForCollocation(e.id);
      return {
        expression: e.fullPhrase || e.headword,
        reading: e.headwordReading || undefined,
        meaning: e.notes || undefined,
        exampleSentence: e.exampleSentences[0],
        exampleSource: undefined,
        discourseContexts: contexts,
        tags: e.tags,
      };
    });
  }

  /**
   * Creates or updates a collocation entry from surfer data, merging discourse
   * contexts if the expression already exists. Returns the collocation ID.
   */
  async addEntryFromSurfer(
    surferEntry: SurferCollocationEntry,
    maxContexts: number
  ): Promise<string> {
    // Check for existing entry by expression match
    const all = this.collocationStore.getAll();
    const existing = all.find(
      e =>
        e.fullPhrase === surferEntry.expression ||
        e.headword === surferEntry.expression
    );

    let collocationId: string;

    if (existing) {
      collocationId = existing.id;
      // Merge: add example sentence if new
      if (
        surferEntry.exampleSentence &&
        !existing.exampleSentences.includes(surferEntry.exampleSentence)
      ) {
        existing.exampleSentences.push(surferEntry.exampleSentence);
        this.collocationStore.update(existing);
      }
      // Merge tags
      const newTags = surferEntry.tags.filter(t => !existing.tags.includes(t));
      if (newTags.length > 0) {
        existing.tags.push(...newTags);
        this.collocationStore.update(existing);
      }
    } else {
      // Create a new entry
      collocationId = this.collocationStore.generateId();
      this.collocationStore.add({
        id: collocationId,
        headword: surferEntry.expression,
        headwordReading: surferEntry.reading ?? "",
        collocate: "",
        fullPhrase: surferEntry.expression,
        headwordPOS: PartOfSpeech.Expression,
        collocatePOS: PartOfSpeech.Other,
        pattern: "",
        exampleSentences: surferEntry.exampleSentence ? [surferEntry.exampleSentence] : [],
        source: CollocationSource.Manual,
        tags: surferEntry.tags,
        notes: surferEntry.meaning ?? "",
        frequency: 50,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // Add all discourse contexts
    for (const ctx of surferEntry.discourseContexts) {
      await this.addContext(collocationId, ctx, maxContexts);
    }

    return collocationId;
  }

  /**
   * Adds or deduplicates an example sentence for a collocation entry.
   */
  async saveExampleSentence(
    collocationId: string,
    sentence: string,
    source: { file: string; timestamp?: string; url?: string }
  ): Promise<void> {
    const entry = this.collocationStore.getById(collocationId);
    if (!entry) return;

    if (!entry.exampleSentences.includes(sentence)) {
      entry.exampleSentences.push(sentence);
      // Store source info in notes if not already present
      const sourceNote = `[${source.file}${source.timestamp ? ` @${source.timestamp}` : ""}${source.url ? ` ${source.url}` : ""}]`;
      if (!entry.notes.includes(sourceNote)) {
        entry.notes = entry.notes ? `${entry.notes}\n${sourceNote}` : sourceNote;
      }
      this.collocationStore.update(entry);
    }
  }

  getIndex(): DiscourseIndex {
    return this.index;
  }

  /**
   * Returns a Map from expression string → collocation ID for efficient lookups
   * in UI filtering (avoids O(n) scan per filter operation).
   */
  buildExpressionToIdMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of this.collocationStore.getAll()) {
      if (entry.fullPhrase) map.set(entry.fullPhrase, entry.id);
      if (entry.headword) map.set(entry.headword, entry.id);
    }
    return map;
  }
}
