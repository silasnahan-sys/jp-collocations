import type { App } from "obsidian";
import { type CollocationEntry, type CollocationIndex, type StoreStats, CollocationSource } from "../types.ts";
import { SEED_DATA } from "./seed-data.ts";

export class CollocationStore {
  private entries: Map<string, CollocationEntry> = new Map();
  private index: CollocationIndex = {
    byHeadword: new Map(),
    byPOS: new Map(),
    byPattern: new Map(),
    byTag: new Map(),
    byRegister: new Map(),
    byJLPT: new Map(),
    byBoundaryType: new Map(),
    byStrength: new Map(),
    byConstituent: new Map(),
    byIdiomaticityLayer: new Map(),
    byCollocationRelation: new Map(),
  };
  private app: App;
  private dataPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private changeCallbacks: Array<() => void> = [];

  constructor(app: App, dataPath: string) {
    this.app = app;
    this.dataPath = dataPath;
  }

  async load(): Promise<void> {
    try {
      const exists = await this.app.vault.adapter.exists(this.dataPath);
      if (exists) {
        const raw = await this.app.vault.adapter.read(this.dataPath);
        const parsed: CollocationEntry[] = JSON.parse(raw);
        for (const e of parsed) {
          this.entries.set(e.id, e);
        }
      } else {
        for (const e of SEED_DATA) {
          this.entries.set(e.id, e);
        }
        await this.save();
      }
    } catch {
      for (const e of SEED_DATA) {
        this.entries.set(e.id, e);
      }
    }
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.index = {
      byHeadword: new Map(),
      byPOS: new Map(),
      byPattern: new Map(),
      byTag: new Map(),
      byRegister: new Map(),
      byJLPT: new Map(),
      byBoundaryType: new Map(),
      byStrength: new Map(),
      byConstituent: new Map(),
      byIdiomaticityLayer: new Map(),
      byCollocationRelation: new Map(),
    };
    for (const entry of this.entries.values()) {
      this.indexEntry(entry);
    }
  }

  private indexEntry(entry: CollocationEntry): void {
    this.addToIndex(this.index.byHeadword, entry.headword, entry.id);
    this.addToIndex(this.index.byPOS, entry.headwordPOS, entry.id);
    this.addToIndex(this.index.byPattern, entry.pattern, entry.id);
    for (const tag of entry.tags) {
      this.addToIndex(this.index.byTag, tag, entry.id);
    }
    if (entry.register) this.addToIndex(this.index.byRegister, entry.register, entry.id);
    if (entry.jlptLevel) this.addToIndex(this.index.byJLPT, entry.jlptLevel, entry.id);
    if (entry.boundaryType) this.addToIndex(this.index.byBoundaryType, entry.boundaryType, entry.id);
    if (entry.strength) this.addToIndex(this.index.byStrength, entry.strength, entry.id);
    if (entry.constituentTokens) {
      for (const token of entry.constituentTokens) {
        if (token) this.addToIndex(this.index.byConstituent, token, entry.id);
      }
    }
    if (entry.idiomaticityLayer) this.addToIndex(this.index.byIdiomaticityLayer, entry.idiomaticityLayer, entry.id);
    if (entry.collocationRelation) this.addToIndex(this.index.byCollocationRelation, entry.collocationRelation, entry.id);
  }

  private deindexEntry(entry: CollocationEntry): void {
    this.removeFromIndex(this.index.byHeadword, entry.headword, entry.id);
    this.removeFromIndex(this.index.byPOS, entry.headwordPOS, entry.id);
    this.removeFromIndex(this.index.byPattern, entry.pattern, entry.id);
    for (const tag of entry.tags) {
      this.removeFromIndex(this.index.byTag, tag, entry.id);
    }
    if (entry.register) this.removeFromIndex(this.index.byRegister, entry.register, entry.id);
    if (entry.jlptLevel) this.removeFromIndex(this.index.byJLPT, entry.jlptLevel, entry.id);
    if (entry.boundaryType) this.removeFromIndex(this.index.byBoundaryType, entry.boundaryType, entry.id);
    if (entry.strength) this.removeFromIndex(this.index.byStrength, entry.strength, entry.id);
    if (entry.constituentTokens) {
      for (const token of entry.constituentTokens) {
        if (token) this.removeFromIndex(this.index.byConstituent, token, entry.id);
      }
    }
    if (entry.idiomaticityLayer) this.removeFromIndex(this.index.byIdiomaticityLayer, entry.idiomaticityLayer, entry.id);
    if (entry.collocationRelation) this.removeFromIndex(this.index.byCollocationRelation, entry.collocationRelation, entry.id);
  }

  private addToIndex(map: Map<string, string[]>, key: string, id: string): void {
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key)!;
    if (!arr.includes(id)) arr.push(id);
  }

  private removeFromIndex(map: Map<string, string[]>, key: string, id: string): void {
    const arr = map.get(key);
    if (!arr) return;
    const idx = arr.indexOf(id);
    if (idx !== -1) arr.splice(idx, 1);
  }

  private notifyChange(): void {
    for (const cb of this.changeCallbacks) {
      try { cb(); } catch { /* ignore */ }
    }
  }

  onStoreChange(callback: () => void): void {
    if (!this.changeCallbacks.includes(callback)) {
      this.changeCallbacks.push(callback);
    }
  }

  offStoreChange(callback: () => void): void {
    const idx = this.changeCallbacks.indexOf(callback);
    if (idx !== -1) this.changeCallbacks.splice(idx, 1);
  }

  getAll(): CollocationEntry[] {
    return Array.from(this.entries.values());
  }

  getById(id: string): CollocationEntry | undefined {
    return this.entries.get(id);
  }

  getByHeadword(headword: string): CollocationEntry[] {
    const ids = this.index.byHeadword.get(headword) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByPOS(pos: string): CollocationEntry[] {
    const ids = this.index.byPOS.get(pos) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByPattern(pattern: string): CollocationEntry[] {
    const ids = this.index.byPattern.get(pattern) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByTag(tag: string): CollocationEntry[] {
    const ids = this.index.byTag.get(tag) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByRegister(register: string): CollocationEntry[] {
    const ids = this.index.byRegister.get(register) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByJLPT(level: string): CollocationEntry[] {
    const ids = this.index.byJLPT.get(level) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByBoundaryType(type: string): CollocationEntry[] {
    const ids = this.index.byBoundaryType.get(type) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByStrength(strength: string): CollocationEntry[] {
    const ids = this.index.byStrength.get(strength) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByConstituent(token: string): CollocationEntry[] {
    const ids = this.index.byConstituent.get(token) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByIdiomaticityLayer(layer: string): CollocationEntry[] {
    const ids = this.index.byIdiomaticityLayer.get(layer) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  getByCollocationRelation(relation: string): CollocationEntry[] {
    const ids = this.index.byCollocationRelation.get(relation) ?? [];
    return ids.map(id => this.entries.get(id)!).filter(Boolean);
  }

  /** Get all cross-register variants for a given entry */
  getCrossRegisterVariants(entryId: string): CollocationEntry[] {
    const entry = this.entries.get(entryId);
    if (!entry?.crossRegisterVariants) return [];
    return entry.crossRegisterVariants
      .map(id => this.entries.get(id))
      .filter((e): e is CollocationEntry => e !== undefined);
  }

  /** Get all competing expressions for a given entry */
  getCompetingExpressions(entryId: string): CollocationEntry[] {
    const entry = this.entries.get(entryId);
    if (!entry?.competingExpressions) return [];
    return entry.competingExpressions
      .map(id => this.entries.get(id))
      .filter((e): e is CollocationEntry => e !== undefined);
  }

  add(entry: CollocationEntry): void {
    this.entries.set(entry.id, entry);
    this.indexEntry(entry);
    this.scheduleSave();
    this.notifyChange();
  }

  update(entry: CollocationEntry): void {
    const old = this.entries.get(entry.id);
    if (old) this.deindexEntry(old);
    entry.updatedAt = Date.now();
    this.entries.set(entry.id, entry);
    this.indexEntry(entry);
    this.scheduleSave();
    this.notifyChange();
  }

  delete(id: string): void {
    const entry = this.entries.get(id);
    if (entry) {
      this.deindexEntry(entry);
      this.entries.delete(id);
      this.scheduleSave();
      this.notifyChange();
    }
  }

  bulkImport(entries: CollocationEntry[]): number {
    let count = 0;
    for (const e of entries) {
      this.entries.set(e.id, e);
      this.indexEntry(e);
      count++;
    }
    this.scheduleSave();
    this.notifyChange();
    return count;
  }

  exportAll(): CollocationEntry[] {
    return this.getAll();
  }

  async resetToSeed(): Promise<void> {
    this.entries.clear();
    for (const e of SEED_DATA) {
      this.entries.set(e.id, e);
    }
    this.rebuildIndex();
    await this.save();
    this.notifyChange();
  }

  async clearAll(): Promise<void> {
    this.entries.clear();
    this.rebuildIndex();
    await this.save();
    this.notifyChange();
  }

  getStats(): StoreStats {
    const byPOS: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const e of this.entries.values()) {
      byPOS[e.headwordPOS] = (byPOS[e.headwordPOS] ?? 0) + 1;
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }
    return { total: this.entries.size, byPOS, bySource };
  }

  getAllTags(): string[] {
    return Array.from(this.index.byTag.keys()).sort();
  }

  getAllPatterns(): string[] {
    return Array.from(this.index.byPattern.keys()).sort();
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

  getIndex(): CollocationIndex {
    return this.index;
  }

  size(): number {
    return this.entries.size;
  }

  generateId(): string {
    return `entry_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  hasSource(source: CollocationSource): boolean {
    for (const e of this.entries.values()) {
      if (e.source === source) return true;
    }
    return false;
  }
}
