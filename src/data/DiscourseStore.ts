import type { App } from "obsidian";
import type {
  DiscourseContext,
  DiscourseIndex,
  DiscourseChunkRecord,
  DiscourseStats,
} from "../types.ts";

/** Manages discourse-index.json with 3 inverted lookup maps. */
export class DiscourseStore {
  private app: App;
  private indexPath: string;
  private maxContextsPerCollocation: number;

  private index: DiscourseIndex = {
    chunks: {},
    byMarker: {},
    byCategory: {},
    byCollocation: {},
  };

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App, indexPath: string, maxContextsPerCollocation = 20) {
    this.app = app;
    this.indexPath = indexPath;
    this.maxContextsPerCollocation = maxContextsPerCollocation;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async load(): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(this.indexPath);
      if (exists) {
        const raw = await this.app.vault.adapter.read(this.indexPath);
        const parsed: DiscourseIndex = JSON.parse(raw);
        this.index = parsed;
        // Full rebuild of inverted maps to ensure consistency
        this.rebuildInvertedMaps();
      }
    } catch (e) {
      console.error("DiscourseStore: failed to load index:", e);
      // Start with empty index on error
      this.index = { chunks: {}, byMarker: {}, byCategory: {}, byCollocation: {} };
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

  // ── Core Operations ──────────────────────────────────────────────

  /**
   * Add a DiscourseContext. Returns the new chunk ID or null if it was a
   * duplicate (same chunkText + source.file).
   */
  addContext(context: DiscourseContext, collocationIds: string[]): string | null {
    // Dedup: skip if we already have this exact chunkText from the same file
    for (const record of Object.values(this.index.chunks)) {
      if (
        record.context.chunkText === context.chunkText &&
        record.context.source.file === context.source.file
      ) {
        return null;
      }
    }

    const id = `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: DiscourseChunkRecord = { id, context, collocationIds };
    this.index.chunks[id] = record;

    // Update inverted maps
    for (const marker of context.markers) {
      this.addToMap(this.index.byMarker, marker.surface, id);
    }
    this.addToMap(this.index.byCategory, context.markers[0]?.category ?? "connective", id);
    for (const colId of collocationIds) {
      this.addToMap(this.index.byCollocation, colId, id);
      this.enforceMaxContexts(colId);
    }

    this.scheduleSave();
    return id;
  }

  /** Attach an existing chunk to an additional collocation ID. */
  linkCollocation(chunkId: string, collocationId: string): void {
    const record = this.index.chunks[chunkId];
    if (!record) return;
    if (!record.collocationIds.includes(collocationId)) {
      record.collocationIds.push(collocationId);
    }
    this.addToMap(this.index.byCollocation, collocationId, chunkId);
    this.enforceMaxContexts(collocationId);
    this.scheduleSave();
  }

  getChunk(id: string): DiscourseChunkRecord | undefined {
    return this.index.chunks[id];
  }

  getChunksByMarker(surface: string): DiscourseChunkRecord[] {
    const ids = this.index.byMarker[surface] ?? [];
    return ids.map(id => this.index.chunks[id]).filter(Boolean);
  }

  getChunksByCategory(category: string): DiscourseChunkRecord[] {
    const ids = this.index.byCategory[category] ?? [];
    return ids.map(id => this.index.chunks[id]).filter(Boolean);
  }

  getChunksByCollocation(collocationId: string): DiscourseChunkRecord[] {
    const ids = this.index.byCollocation[collocationId] ?? [];
    return ids.map(id => this.index.chunks[id]).filter(Boolean);
  }

  getAllChunks(): DiscourseChunkRecord[] {
    return Object.values(this.index.chunks);
  }

  getStats(): DiscourseStats {
    const byCategory: Record<string, number> = {};
    const markerCounts: Record<string, number> = {};
    const collocationCounts: Record<string, number> = {};

    for (const record of Object.values(this.index.chunks)) {
      for (const marker of record.context.markers) {
        markerCounts[marker.surface] = (markerCounts[marker.surface] ?? 0) + 1;
        byCategory[marker.category] = (byCategory[marker.category] ?? 0) + 1;
      }
      for (const colId of record.collocationIds) {
        collocationCounts[colId] = (collocationCounts[colId] ?? 0) + 1;
      }
    }

    const topMarkers = Object.entries(markerCounts)
      .map(([surface, count]) => ({ surface, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const topCollocations = Object.entries(collocationCounts)
      .map(([id, contextCount]) => ({ id, contextCount }))
      .sort((a, b) => b.contextCount - a.contextCount)
      .slice(0, 20);

    return {
      totalChunks: Object.keys(this.index.chunks).length,
      byCategory,
      topMarkers,
      topCollocations,
    };
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private addToMap(map: Record<string, string[]>, key: string, id: string): void {
    if (!map[key]) map[key] = [];
    if (!map[key].includes(id)) map[key].push(id);
  }

  /** Evict oldest chunks if collocation exceeds the max-contexts limit. */
  private enforceMaxContexts(collocationId: string): void {
    const ids = this.index.byCollocation[collocationId];
    if (!ids || ids.length <= this.maxContextsPerCollocation) return;

    // Sort by capturedAt ascending (oldest first) and remove excess
    ids.sort((a, b) => {
      const ta = this.index.chunks[a]?.context.capturedAt ?? "";
      const tb = this.index.chunks[b]?.context.capturedAt ?? "";
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    const toRemove = ids.splice(0, ids.length - this.maxContextsPerCollocation);
    for (const chunkId of toRemove) {
      this.removeChunk(chunkId);
    }
  }

  private removeChunk(chunkId: string): void {
    const record = this.index.chunks[chunkId];
    if (!record) return;

    // Remove from all inverted maps
    for (const marker of record.context.markers) {
      this.removeFromMap(this.index.byMarker, marker.surface, chunkId);
    }
    this.removeFromMap(this.index.byCategory, record.context.markers[0]?.category ?? "", chunkId);
    for (const colId of record.collocationIds) {
      this.removeFromMap(this.index.byCollocation, colId, chunkId);
    }

    delete this.index.chunks[chunkId];
  }

  private removeFromMap(map: Record<string, string[]>, key: string, id: string): void {
    if (!map[key]) return;
    const idx = map[key].indexOf(id);
    if (idx !== -1) map[key].splice(idx, 1);
    if (map[key].length === 0) delete map[key];
  }

  /** Rebuild all inverted maps from scratch (used after loading persisted data). */
  private rebuildInvertedMaps(): void {
    this.index.byMarker = {};
    this.index.byCategory = {};
    this.index.byCollocation = {};

    for (const record of Object.values(this.index.chunks)) {
      for (const marker of record.context.markers) {
        this.addToMap(this.index.byMarker, marker.surface, record.id);
        this.addToMap(this.index.byCategory, marker.category, record.id);
      }
      for (const colId of record.collocationIds) {
        this.addToMap(this.index.byCollocation, colId, record.id);
      }
    }
  }
}
