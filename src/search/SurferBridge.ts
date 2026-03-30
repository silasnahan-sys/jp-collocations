import type { CollocationEntry } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { SearchEngine } from "./SearchEngine.ts";
import { CollocationScanner } from "./CollocationScanner.ts";
import { type BoundaryType, type JLPTLevel, type Register, CollocationStrength } from "../types.ts";

export interface CollocationSpan {
  entryId: string;
  start: number;
  end: number;
  fullPhrase: string;
  headword: string;
  pattern: string;
  strength: CollocationStrength;
  register?: Register;
  jlptLevel?: JLPTLevel;
  boundaryType?: BoundaryType;
}

export class SurferBridge {
  private store: CollocationStore;
  private engine: SearchEngine;
  private scanner: CollocationScanner;
  private changeCallbacks: Array<() => void> = [];
  private storeChangeListener: () => void;

  constructor(store: CollocationStore, engine: SearchEngine) {
    this.store = store;
    this.engine = engine;
    this.scanner = new CollocationScanner(store);
    this.scanner.buildIndex();

    this.storeChangeListener = () => {
      this.scanner.buildIndex();
      for (const cb of this.changeCallbacks) {
        try { cb(); } catch { /* ignore */ }
      }
    };
    this.store.onStoreChange(this.storeChangeListener);
  }

  destroy(): void {
    this.store.offStoreChange(this.storeChangeListener);
    this.scanner.destroy();
  }

  /**
   * Scan text and return all collocation spans with char offsets.
   * Designed for real-time use: <50ms for 5000-word docs with 2000+ entries.
   */
  getCollocationSpans(text: string): CollocationSpan[] {
    return this.scanner.scan(text);
  }

  /**
   * Get a single entry by ID for popup display.
   */
  getEntryById(id: string): CollocationEntry | null {
    return this.store.getById(id) ?? null;
  }

  /**
   * Quick morpheme match — given tokens, return matching entries.
   */
  matchMorphemes(tokens: string[]): CollocationEntry[] {
    const seen = new Set<string>();
    const results: CollocationEntry[] = [];

    for (const token of tokens) {
      const entries = this.store.getByConstituent(token);
      for (const e of entries) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          results.push(e);
        }
      }
      // Also try headword match
      const byHeadword = this.store.getByHeadword(token);
      for (const e of byHeadword) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          results.push(e);
        }
      }
    }

    return results;
  }

  /**
   * Register a callback for store changes (so surfer can invalidate cache).
   */
  onStoreChange(callback: () => void): void {
    if (!this.changeCallbacks.includes(callback)) {
      this.changeCallbacks.push(callback);
    }
  }

  /**
   * Remove change callback.
   */
  offStoreChange(callback: () => void): void {
    const idx = this.changeCallbacks.indexOf(callback);
    if (idx !== -1) this.changeCallbacks.splice(idx, 1);
  }

  /**
   * Set cache size (number of documents to cache).
   */
  setCacheSize(size: number): void {
    this.scanner.setCacheSize(size);
  }

  /**
   * Rebuild the scanning index (call after bulk imports).
   */
  rebuildIndex(): void {
    this.scanner.buildIndex();
  }

  /**
   * Find all cross-register variants for an entry (e.g. intensifier scale-mates).
   */
  findIntensifierScaleMates(entryId: string): import("../types.ts").CollocationEntry[] {
    return this.engine.findIntensifierScaleMates(entryId);
  }

  /**
   * Find competing expressions (e.g. 激しい雨 vs 強い雨 vs 大雨).
   */
  findCompetingExpressions(entryId: string): import("../types.ts").CollocationEntry[] {
    return this.engine.findCompetingExpressions(entryId);
  }
}
