import type { App } from "obsidian";
import type { StoredChunk, DiscourseCategory, DiscourseFunction } from "../types.ts";

interface ChunkIndex {
  byMarker: Map<string, string[]>;      // surface text → chunk IDs
  byCategory: Map<string, string[]>;    // DiscourseCategory → chunk IDs
  byCollocation: Map<string, string[]>; // collocation ID → chunk IDs
}

export class DiscourseStore {
  private chunks: Map<string, StoredChunk> = new Map();
  private index: ChunkIndex = {
    byMarker: new Map(),
    byCategory: new Map(),
    byCollocation: new Map(),
  };
  private app: App;
  private dataPath: string;
  private counter = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App, dataPath: string) {
    this.app = app;
    this.dataPath = dataPath;
  }

  async load(): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(this.dataPath);
      if (exists) {
        const raw = await this.app.vault.adapter.read(this.dataPath);
        const parsed: StoredChunk[] = JSON.parse(raw);
        for (const c of parsed) {
          this.chunks.set(c.id, c);
        }
      }
    } catch {
      // Start with empty store
    }
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.index = { byMarker: new Map(), byCategory: new Map(), byCollocation: new Map() };
    for (const chunk of this.chunks.values()) {
      this.indexChunk(chunk);
    }
  }

  private indexChunk(chunk: StoredChunk): void {
    this.addToIndex(this.index.byMarker, chunk.surface, chunk.id);
    this.addToIndex(this.index.byCategory, chunk.category, chunk.id);
    for (const col of chunk.collocations) {
      this.addToIndex(this.index.byCollocation, col, chunk.id);
    }
  }

  private deindexChunk(chunk: StoredChunk): void {
    this.removeFromIndex(this.index.byMarker, chunk.surface, chunk.id);
    this.removeFromIndex(this.index.byCategory, chunk.category, chunk.id);
    for (const col of chunk.collocations) {
      this.removeFromIndex(this.index.byCollocation, col, chunk.id);
    }
  }

  private addToIndex(map: Map<string, string[]>, key: string, id: string): void {
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key)!;
    if (!arr.includes(id)) arr.push(id);
  }

  private removeFromIndex(map: Map<string, string[]>, key: string, id: string): void {
    const arr = map.get(key);
    if (!arr) return;
    const i = arr.indexOf(id);
    if (i !== -1) arr.splice(i, 1);
  }

  generateId(): string {
    return `chunk_${++this.counter}_${Date.now()}`;
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  add(chunk: StoredChunk): void {
    this.chunks.set(chunk.id, chunk);
    this.indexChunk(chunk);
    this.scheduleSave();
  }

  update(chunk: StoredChunk): void {
    const old = this.chunks.get(chunk.id);
    if (old) this.deindexChunk(old);
    chunk.updatedAt = Date.now();
    this.chunks.set(chunk.id, chunk);
    this.indexChunk(chunk);
    this.scheduleSave();
  }

  delete(id: string): void {
    const chunk = this.chunks.get(id);
    if (chunk) {
      this.deindexChunk(chunk);
      this.chunks.delete(id);
      this.scheduleSave();
    }
  }

  getById(id: string): StoredChunk | undefined {
    return this.chunks.get(id);
  }

  getAll(): StoredChunk[] {
    return Array.from(this.chunks.values());
  }

  // ─── Index lookups ──────────────────────────────────────────────────────────

  getByMarker(surface: string): StoredChunk[] {
    const ids = this.index.byMarker.get(surface) ?? [];
    return ids.map(id => this.chunks.get(id)!).filter(Boolean);
  }

  getByCategory(category: DiscourseCategory): StoredChunk[] {
    const ids = this.index.byCategory.get(category) ?? [];
    return ids.map(id => this.chunks.get(id)!).filter(Boolean);
  }

  getByCollocation(colId: string): StoredChunk[] {
    const ids = this.index.byCollocation.get(colId) ?? [];
    return ids.map(id => this.chunks.get(id)!).filter(Boolean);
  }

  // ─── Bridge API methods (8) for jp-sentence-surfer ─────────────────────────

  queryChunks(opts: { category?: DiscourseCategory; marker?: string; colId?: string }): StoredChunk[] {
    if (opts.category) return this.getByCategory(opts.category);
    if (opts.marker)   return this.getByMarker(opts.marker);
    if (opts.colId)    return this.getByCollocation(opts.colId);
    return this.getAll();
  }

  countByCategory(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [cat, ids] of this.index.byCategory.entries()) {
      out[cat] = ids.length;
    }
    return out;
  }

  size(): number {
    return this.chunks.size;
  }

  exportAll(): StoredChunk[] {
    return this.getAll();
  }

  bulkImport(chunks: StoredChunk[]): number {
    let count = 0;
    for (const c of chunks) {
      this.chunks.set(c.id, c);
      this.indexChunk(c);
      count++;
    }
    this.scheduleSave();
    return count;
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save().catch(console.error);
    }, 1000);
  }

  async save(): Promise<void> {
    const data = JSON.stringify(this.getAll(), null, 2);
    await this.app.vault.adapter.write(this.dataPath, data);
  }
}
