import type { App } from "obsidian";
import type { ContextChunk, ContextEntry, DiscourseBit, DiscourseCategory, DiscourseFunction } from "../types.ts";

/**
 * Index that allows deep querying of discourse bits by category, function,
 * speaker, and connection group across all stored chunks.
 */
interface DiscourseBitIndex {
  /** chunkId → bit id[] */
  byChunk: Map<string, string[]>;
  /** DiscourseCategory → bit id[] */
  byCategory: Map<string, string[]>;
  /** DiscourseFunction → bit id[] */
  byFunction: Map<string, string[]>;
  /** speaker name → bit id[] */
  bySpeaker: Map<string, string[]>;
  /** "chunkId:connectionGroup" → bit id[] */
  byConnectionGroup: Map<string, string[]>;
}

/**
 * Persistent store for context chunks and context entries.
 * Mirrors the pattern used by CollocationStore but for discourse data.
 *
 * Includes a DiscourseBitIndex for deep searchability across all bits
 * by category, function, speaker, and connection group.
 */
export class ContextStore {
  private chunks: Map<string, ContextChunk> = new Map();
  private entries: Map<string, ContextEntry> = new Map();
  /** Fast-lookup map: bitId → the DiscourseBit object */
  private bitLookup: Map<string, { bit: DiscourseBit; chunkId: string }> = new Map();
  private bitIndex: DiscourseBitIndex = this.emptyIndex();
  private app: App;
  private dataPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App, dataPath: string) {
    this.app = app;
    this.dataPath = dataPath;
  }

  private emptyIndex(): DiscourseBitIndex {
    return {
      byChunk: new Map(),
      byCategory: new Map(),
      byFunction: new Map(),
      bySpeaker: new Map(),
      byConnectionGroup: new Map(),
    };
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
    this.rebuildBitIndex();
  }

  // ── Bit Index ─────────────────────────────────────────────

  private rebuildBitIndex(): void {
    this.bitIndex = this.emptyIndex();
    this.bitLookup.clear();
    for (const chunk of this.chunks.values()) {
      this.indexChunkBits(chunk);
    }
  }

  private indexChunkBits(chunk: ContextChunk): void {
    for (const bit of chunk.bits) {
      this.bitLookup.set(bit.id, { bit, chunkId: chunk.id });

      this.addToIdx(this.bitIndex.byChunk, chunk.id, bit.id);

      if (bit.category) {
        this.addToIdx(this.bitIndex.byCategory, bit.category, bit.id);
      }
      for (const fn of bit.functions) {
        this.addToIdx(this.bitIndex.byFunction, fn, bit.id);
      }
      this.addToIdx(this.bitIndex.bySpeaker, bit.speaker, bit.id);
      this.addToIdx(
        this.bitIndex.byConnectionGroup,
        `${chunk.id}:${bit.connectionGroup}`,
        bit.id,
      );
    }
  }

  private deindexChunkBits(chunkId: string): void {
    const bitIds = this.bitIndex.byChunk.get(chunkId) ?? [];
    for (const bitId of bitIds) {
      const info = this.bitLookup.get(bitId);
      if (!info) continue;
      const { bit } = info;

      if (bit.category) {
        this.removeFromIdx(this.bitIndex.byCategory, bit.category, bitId);
      }
      for (const fn of bit.functions) {
        this.removeFromIdx(this.bitIndex.byFunction, fn, bitId);
      }
      this.removeFromIdx(this.bitIndex.bySpeaker, bit.speaker, bitId);
      this.removeFromIdx(
        this.bitIndex.byConnectionGroup,
        `${chunkId}:${bit.connectionGroup}`,
        bitId,
      );
      this.bitLookup.delete(bitId);
    }
    this.bitIndex.byChunk.delete(chunkId);
  }

  private addToIdx(map: Map<string, string[]>, key: string, id: string): void {
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key)!;
    if (!arr.includes(id)) arr.push(id);
  }

  private removeFromIdx(map: Map<string, string[]>, key: string, id: string): void {
    const arr = map.get(key);
    if (!arr) return;
    const idx = arr.indexOf(id);
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) map.delete(key);
  }

  // ── Bit queries ───────────────────────────────────────────

  getBit(bitId: string): { bit: DiscourseBit; chunkId: string } | undefined {
    return this.bitLookup.get(bitId);
  }

  getBitsByCategory(category: DiscourseCategory | string): DiscourseBit[] {
    const ids = this.bitIndex.byCategory.get(category) ?? [];
    return ids.map(id => this.bitLookup.get(id)?.bit).filter(Boolean) as DiscourseBit[];
  }

  getBitsByFunction(fn: DiscourseFunction | string): DiscourseBit[] {
    const ids = this.bitIndex.byFunction.get(fn) ?? [];
    return ids.map(id => this.bitLookup.get(id)?.bit).filter(Boolean) as DiscourseBit[];
  }

  getBitsBySpeaker(speaker: string): DiscourseBit[] {
    const ids = this.bitIndex.bySpeaker.get(speaker) ?? [];
    return ids.map(id => this.bitLookup.get(id)?.bit).filter(Boolean) as DiscourseBit[];
  }

  /** Get all unique categories across all indexed bits. */
  getAllCategories(): string[] {
    return Array.from(this.bitIndex.byCategory.keys()).sort();
  }

  /** Get all unique functions across all indexed bits. */
  getAllFunctions(): string[] {
    return Array.from(this.bitIndex.byFunction.keys()).sort();
  }

  /** Get all unique speakers across all indexed bits. */
  getAllSpeakers(): string[] {
    return Array.from(this.bitIndex.bySpeaker.keys()).sort();
  }

  /** Get frequency counts for each discourse function across all bits. */
  getFunctionDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const [fn, ids] of this.bitIndex.byFunction) {
      dist[fn] = ids.length;
    }
    return dist;
  }

  /** Get frequency counts for each discourse category. */
  getCategoryDistribution(): Record<string, number> {
    const dist: Record<string, number> = {};
    for (const [cat, ids] of this.bitIndex.byCategory) {
      dist[cat] = ids.length;
    }
    return dist;
  }

  /** Total indexed bits across all chunks. */
  totalBits(): number {
    return this.bitLookup.size;
  }

  // ── Chunks ────────────────────────────────────────────────

  addChunk(chunk: ContextChunk): void {
    this.chunks.set(chunk.id, chunk);
    this.indexChunkBits(chunk);
    this.scheduleSave();
  }

  getChunk(id: string): ContextChunk | undefined {
    return this.chunks.get(id);
  }

  getAllChunks(): ContextChunk[] {
    return Array.from(this.chunks.values());
  }

  deleteChunk(id: string): void {
    this.deindexChunkBits(id);
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

  size(): { chunks: number; entries: number; bits: number } {
    return { chunks: this.chunks.size, entries: this.entries.size, bits: this.bitLookup.size };
  }
}
