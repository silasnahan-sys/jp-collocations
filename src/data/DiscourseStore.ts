import type { App } from "obsidian";
import type { DiscourseContext, DiscourseCategory } from "../types.ts";

interface StoredChunk {
  id: string;
  collocationId: string;
  context: DiscourseContext;
}

interface DiscourseIndex {
  byMarker: Record<string, string[]>;
  byCategory: Record<string, string[]>;
  byCollocation: Record<string, string[]>;
}

export class DiscourseStore {
  private chunks: Map<string, StoredChunk> = new Map();
  private index: DiscourseIndex = { byMarker: {}, byCategory: {}, byCollocation: {} };
  private app: App;
  private dataPath: string;
  private maxContexts: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private chunkCounter = 0;

  constructor(app: App, dataPath: string, maxContexts = 1000) {
    this.app = app;
    this.dataPath = dataPath;
    this.maxContexts = maxContexts;
  }

  async load(): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(this.dataPath);
      if (exists) {
        const raw = await this.app.vault.adapter.read(this.dataPath);
        const parsed: StoredChunk[] = JSON.parse(raw);
        for (const chunk of parsed) {
          this.chunks.set(chunk.id, chunk);
        }
      }
    } catch {
      // Start with empty store on error
    }
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.index = { byMarker: {}, byCategory: {}, byCollocation: {} };
    for (const chunk of this.chunks.values()) {
      this.indexChunk(chunk);
    }
  }

  private indexChunk(chunk: StoredChunk): void {
    const addId = (map: Record<string, string[]>, key: string, id: string) => {
      if (!map[key]) map[key] = [];
      if (!map[key].includes(id)) map[key].push(id);
    };

    addId(this.index.byCollocation, chunk.collocationId, chunk.id);

    for (const marker of chunk.context.markers) {
      addId(this.index.byMarker, marker.surface, chunk.id);
      addId(this.index.byCategory, marker.category, chunk.id);
    }
  }

  private deindexChunk(chunk: StoredChunk): void {
    const removeId = (map: Record<string, string[]>, key: string, id: string) => {
      const arr = map[key];
      if (!arr) return;
      const idx = arr.indexOf(id);
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) delete map[key];
    };

    removeId(this.index.byCollocation, chunk.collocationId, chunk.id);

    for (const marker of chunk.context.markers) {
      removeId(this.index.byMarker, marker.surface, chunk.id);
      removeId(this.index.byCategory, marker.category, chunk.id);
    }
  }

  private deduplicationKey(context: DiscourseContext): string {
    return `${context.chunkText}::${context.source.file}`;
  }

  addContext(collocationId: string, context: DiscourseContext): string {
    // Dedup: same chunkText + source.file is treated as identical
    const dedupKey = this.deduplicationKey(context);
    for (const existing of this.chunks.values()) {
      if (this.deduplicationKey(existing.context) === dedupKey) {
        return existing.id;
      }
    }

    const id = `chunk_${Date.now()}_${++this.chunkCounter}`;
    const chunk: StoredChunk = { id, collocationId, context };
    this.chunks.set(id, chunk);
    this.indexChunk(chunk);

    // Enforce max-context limit with oldest-first eviction
    if (this.chunks.size > this.maxContexts) {
      this.evictOldest();
    }

    this.scheduleSave();
    return id;
  }

  private evictOldest(): void {
    const sorted = Array.from(this.chunks.values()).sort((a, b) =>
      a.context.capturedAt.localeCompare(b.context.capturedAt)
    );
    const evictCount = this.chunks.size - this.maxContexts;
    for (let i = 0; i < evictCount; i++) {
      const chunk = sorted[i];
      this.deindexChunk(chunk);
      this.chunks.delete(chunk.id);
    }
  }

  getContextsByCollocation(collocationId: string): DiscourseContext[] {
    const ids = this.index.byCollocation[collocationId] ?? [];
    return ids.map(id => this.chunks.get(id)?.context).filter((c): c is DiscourseContext => c !== undefined);
  }

  getCollocationIdsByMarker(surface: string): string[] {
    const chunkIds = this.index.byMarker[surface] ?? [];
    const collIds = new Set<string>();
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (chunk) collIds.add(chunk.collocationId);
    }
    return Array.from(collIds);
  }

  getCollocationIdsByCategory(category: DiscourseCategory): string[] {
    const chunkIds = this.index.byCategory[category] ?? [];
    const collIds = new Set<string>();
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (chunk) collIds.add(chunk.collocationId);
    }
    return Array.from(collIds);
  }

  getStats(): { markerFrequency: Record<string, number>; categoryFrequency: Record<string, number>; totalContexts: number } {
    const markerFrequency: Record<string, number> = {};
    const categoryFrequency: Record<string, number> = {};
    for (const [marker, ids] of Object.entries(this.index.byMarker)) {
      markerFrequency[marker] = ids.length;
    }
    for (const [category, ids] of Object.entries(this.index.byCategory)) {
      categoryFrequency[category] = ids.length;
    }
    return { markerFrequency, categoryFrequency, totalContexts: this.chunks.size };
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save().catch(console.error);
    }, 1000);
  }

  async save(): Promise<void> {
    const data = JSON.stringify(Array.from(this.chunks.values()), null, 2);
    await this.app.vault.adapter.write(this.dataPath, data);
  }
}
