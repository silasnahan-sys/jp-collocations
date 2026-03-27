import type { App } from "obsidian";
import type { ContextChunk, ContextEntry } from "../types.ts";

/**
 * Persistent store for context chunks and context entries.
 * Mirrors the pattern used by CollocationStore but for discourse data.
 */
export class ContextStore {
  private chunks: Map<string, ContextChunk> = new Map();
  private entries: Map<string, ContextEntry> = new Map();
  private app: App;
  private dataPath: string;
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
        const parsed = JSON.parse(raw) as { chunks: ContextChunk[]; entries: ContextEntry[] };
        for (const c of parsed.chunks ?? []) this.chunks.set(c.id, c);
        for (const e of parsed.entries ?? []) this.entries.set(e.id, e);
      }
    } catch {
      // Start empty on error
    }
  }

  // ── Chunks ────────────────────────────────────────────────

  addChunk(chunk: ContextChunk): void {
    this.chunks.set(chunk.id, chunk);
    this.scheduleSave();
  }

  getChunk(id: string): ContextChunk | undefined {
    return this.chunks.get(id);
  }

  getAllChunks(): ContextChunk[] {
    return Array.from(this.chunks.values());
  }

  deleteChunk(id: string): void {
    this.chunks.delete(id);
    // Also remove entries referencing this chunk
    for (const [eid, entry] of this.entries) {
      if (entry.chunkId === id) this.entries.delete(eid);
    }
    this.scheduleSave();
  }

  // ── Entries ───────────────────────────────────────────────

  addEntry(entry: ContextEntry): void {
    this.entries.set(entry.id, entry);
    this.scheduleSave();
  }

  getEntry(id: string): ContextEntry | undefined {
    return this.entries.get(id);
  }

  getAllEntries(): ContextEntry[] {
    return Array.from(this.entries.values());
  }

  getEntriesByCollocation(collocationId: string): ContextEntry[] {
    return this.getAllEntries().filter(e => e.collocationId === collocationId);
  }

  getEntriesByChunk(chunkId: string): ContextEntry[] {
    return this.getAllEntries().filter(e => e.chunkId === chunkId);
  }

  deleteEntry(id: string): void {
    this.entries.delete(id);
    this.scheduleSave();
  }

  // ── Persistence ───────────────────────────────────────────

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save().catch(console.error);
    }, 1000);
  }

  async save(): Promise<void> {
    const payload = {
      chunks: Array.from(this.chunks.values()),
      entries: Array.from(this.entries.values()),
    };
    const data = JSON.stringify(payload, null, 2);
    await this.app.vault.adapter.write(this.dataPath, data);
  }

  // ── Helpers ───────────────────────────────────────────────

  generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  size(): { chunks: number; entries: number } {
    return { chunks: this.chunks.size, entries: this.entries.size };
  }
}
