/**
 * DictionaryStore — manages multiple imported Yomitan dictionaries.
 *
 * Stores dictionaries in Obsidian vault data, provides:
 *   - O(1) exact lookup by expression / reading
 *   - prefix search for autocomplete
 *   - multi-dict priority-ordered results
 *   - serialization / deserialization for persistence
 */

import type { App } from 'obsidian';
import type {
  DictionaryData,
  DictionaryMeta,
  DictionaryTerm,
  DictionarySettings,
  DictLookupResult,
  YomitanTag,
  YomitanPitchInfo,
  YomitanDefinition,
} from './types';
import { DEFAULT_DICTIONARY_SETTINGS } from './types';
import { toHiragana, normalizeJapanese, isJapanese } from '../utils/japanese';
import { deinflect } from './deinflect';

// ── Serialization types (Maps → plain objects) ───────────────

interface SerializedDictionary {
  meta: DictionaryMeta;
  tags: [string, YomitanTag][];
  terms: DictionaryTerm[];
  expressionIndex: [string, number[]][];
  readingIndex: [string, number[]][];
  frequencies: [string, number][];
  pitches: [string, YomitanPitchInfo][];
}

export class DictionaryStore {
  private app: App;
  private dictionaries: Map<string, DictionaryData> = new Map();
  settings: DictionarySettings = { ...DEFAULT_DICTIONARY_SETTINGS };
  private persistFn: (data: unknown) => Promise<void>;

  constructor(app: App, persistFn: (data: unknown) => Promise<void>) {
    this.app = app;
    this.persistFn = persistFn;
  }

  // ── Load / Save ────────────────────────────────────────────

  loadFromData(saved: { dictionaries?: SerializedDictionary[]; settings?: DictionarySettings }): void {
    if (saved.settings) {
      this.settings = { ...DEFAULT_DICTIONARY_SETTINGS, ...saved.settings };
    }
    if (saved.dictionaries) {
      for (const sd of saved.dictionaries) {
        const data = this.deserialize(sd);
        this.dictionaries.set(data.meta.title, data);
      }
    }
  }

  async save(): Promise<void> {
    const serialized: SerializedDictionary[] = [];
    for (const dict of this.dictionaries.values()) {
      serialized.push(this.serialize(dict));
    }
    await this.persistFn({ dictionaries: serialized, settings: this.settings });
  }

  private serialize(dict: DictionaryData): SerializedDictionary {
    return {
      meta: dict.meta,
      tags: [...dict.tags.entries()],
      terms: dict.terms,
      expressionIndex: [...dict.expressionIndex.entries()],
      readingIndex: [...dict.readingIndex.entries()],
      frequencies: [...dict.frequencies.entries()],
      pitches: [...dict.pitches.entries()],
    };
  }

  private deserialize(sd: SerializedDictionary): DictionaryData {
    return {
      meta: sd.meta,
      tags: new Map(sd.tags),
      terms: sd.terms,
      expressionIndex: new Map(sd.expressionIndex),
      readingIndex: new Map(sd.readingIndex),
      frequencies: new Map(sd.frequencies),
      pitches: new Map(sd.pitches),
    };
  }

  // ── Dictionary management ──────────────────────────────────

  addDictionary(data: DictionaryData): void {
    this.dictionaries.set(data.meta.title, data);
    if (!this.settings.enabledDictionaries.includes(data.meta.title)) {
      this.settings.enabledDictionaries.push(data.meta.title);
    }
  }

  removeDictionary(title: string): void {
    this.dictionaries.delete(title);
    this.settings.enabledDictionaries = this.settings.enabledDictionaries.filter(t => t !== title);
  }

  getDictionaryList(): DictionaryMeta[] {
    return [...this.dictionaries.values()].map(d => d.meta);
  }

  getDictionary(title: string): DictionaryData | undefined {
    return this.dictionaries.get(title);
  }

  hasDictionaries(): boolean {
    return this.dictionaries.size > 0;
  }

  getTotalTermCount(): number {
    let total = 0;
    for (const d of this.dictionaries.values()) total += d.terms.length;
    return total;
  }

  // ── Lookup ─────────────────────────────────────────────────

  /**
   * Look up a term across all enabled dictionaries.
   * Returns results ordered by dictionary priority, then by score.
   * When the exact surface finds nothing, deinflected candidates are tried
   * (食べていた → 食べる) and hits carry their inflection trail.
   */
  lookup(query: string): DictLookupResult[] {
    if (!query.trim()) return [];

    const normalized = normalizeJapanese(query.trim());
    const hiragana = toHiragana(normalized);
    const exact = this.lookupSurface(normalized, hiragana);
    if (exact.length > 0) return exact;

    // Deinflection fallback: candidates are proposals — each is validated
    // against the real indexes here. Shortest trail wins on collisions.
    const results: DictLookupResult[] = [];
    const seen = new Set<string>();
    for (const d of deinflect(normalized)) {
      for (const r of this.lookupSurface(d.term, toHiragana(d.term))) {
        const key = `${r.term.expression}|${r.term.reading}|${r.dictionary}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ ...r, deinflection: d.trail });
      }
      if (results.length >= this.settings.maxResults) break;
    }
    return results.slice(0, this.settings.maxResults);
  }

  /** Exact expression/reading lookup for one surface (no deinflection). */
  private lookupSurface(normalized: string, hiragana: string): DictLookupResult[] {
    const results: DictLookupResult[] = [];

    for (const dictTitle of this.settings.enabledDictionaries) {
      const dict = this.dictionaries.get(dictTitle);
      if (!dict) continue;

      const matchedIds = new Set<number>();

      // Exact expression match
      const exprIds = dict.expressionIndex.get(normalized);
      if (exprIds) exprIds.forEach(id => matchedIds.add(id));

      // Exact reading match
      const readIds = dict.readingIndex.get(normalized);
      if (readIds) readIds.forEach(id => matchedIds.add(id));

      // Hiragana reading match
      if (hiragana !== normalized) {
        const hiraIds = dict.readingIndex.get(hiragana);
        if (hiraIds) hiraIds.forEach(id => matchedIds.add(id));
      }

      for (const id of matchedIds) {
        const term = dict.terms[id];
        if (!term) continue;

        const termTags = term.definitionTags.concat(term.termTags)
          .map(t => dict.tags.get(t))
          .filter((t): t is YomitanTag => !!t);

        results.push({
          term,
          dictionary: dictTitle,
          tags: termTags,
          frequency: dict.frequencies.get(term.expression),
          pitch: dict.pitches.get(term.expression),
        });
      }
    }

    // Sort by score descending (higher = more common)
    results.sort((a, b) => b.term.score - a.term.score);

    return results.slice(0, this.settings.maxResults);
  }

  /**
   * Prefix search for autocomplete / quick-find.
   * Scans expression + reading indexes for prefix matches.
   */
  prefixSearch(prefix: string, limit = 20): DictLookupResult[] {
    if (!prefix.trim()) return [];

    const normalized = normalizeJapanese(prefix.trim());
    const hiragana = toHiragana(normalized);
    const results: DictLookupResult[] = [];
    const seen = new Set<string>(); // dedup by expression+reading+dict

    for (const dictTitle of this.settings.enabledDictionaries) {
      const dict = this.dictionaries.get(dictTitle);
      if (!dict) continue;

      // Scan expression index keys
      for (const [expr, ids] of dict.expressionIndex) {
        if (expr.startsWith(normalized) || expr.startsWith(hiragana)) {
          for (const id of ids) {
            const term = dict.terms[id];
            if (!term) continue;
            const key = `${term.expression}|${term.reading}|${dictTitle}`;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
              term,
              dictionary: dictTitle,
              tags: [],
              frequency: dict.frequencies.get(term.expression),
            });

            if (results.length >= limit) return results;
          }
        }
      }

      // Scan reading index keys
      for (const [read, ids] of dict.readingIndex) {
        if (read.startsWith(normalized) || read.startsWith(hiragana)) {
          for (const id of ids) {
            const term = dict.terms[id];
            if (!term) continue;
            const key = `${term.expression}|${term.reading}|${dictTitle}`;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
              term,
              dictionary: dictTitle,
              tags: [],
              frequency: dict.frequencies.get(term.expression),
            });

            if (results.length >= limit) return results;
          }
        }
      }
    }

    return results;
  }

  /**
   * Substring/contains search for live-as-you-type results.
   * Falls back to prefix, then to substring scan. Fast enough for
   * mobile if dictionaries are reasonably sized (<200K entries).
   */
  substringSearch(query: string, limit = 15): DictLookupResult[] {
    if (!query.trim()) return [];

    // Try exact first
    const exact = this.lookup(query);
    if (exact.length >= limit) return exact.slice(0, limit);

    // Then prefix
    const prefix = this.prefixSearch(query, limit);
    const results = [...exact];
    const seen = new Set(exact.map(r => `${r.term.expression}|${r.term.reading}|${r.dictionary}`));

    for (const r of prefix) {
      const key = `${r.term.expression}|${r.term.reading}|${r.dictionary}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(r);
        if (results.length >= limit) return results;
      }
    }

    // Substring scan (more expensive but catches partial matches)
    const normalized = normalizeJapanese(query.trim());
    const hiragana = toHiragana(normalized);

    for (const dictTitle of this.settings.enabledDictionaries) {
      const dict = this.dictionaries.get(dictTitle);
      if (!dict) continue;

      for (const [expr, ids] of dict.expressionIndex) {
        if (expr.includes(normalized) || expr.includes(hiragana)) {
          for (const id of ids) {
            const term = dict.terms[id];
            if (!term) continue;
            const key = `${term.expression}|${term.reading}|${dictTitle}`;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
              term,
              dictionary: dictTitle,
              tags: [],
              frequency: dict.frequencies.get(term.expression),
            });

            if (results.length >= limit) return results;
          }
        }
      }
    }

    return results;
  }

  /**
   * Render a definition to plain text (strips structured content to readable text).
   */
  static definitionToText(def: YomitanDefinition): string {
    if (typeof def === 'string') return def;
    if (Array.isArray(def)) {
      // Deinflection tuple
      return `→ ${def[0]} (${def[1].join(', ')})`;
    }
    if (def.type === 'text' && def.text) return def.text;
    if (def.type === 'structured-content' && def.content) {
      return DictionaryStore.extractText(def.content);
    }
    if (def.type === 'image') return '[image]';
    return '';
  }

  /**
   * Recursively extract text from structured content nodes.
   */
  static extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(c => DictionaryStore.extractText(c)).join('');
    }
    if (content && typeof content === 'object' && 'tag' in content) {
      const node = content as { tag: string; content?: unknown };
      if (node.tag === 'br') return '\n';
      if (node.content) return DictionaryStore.extractText(node.content);
    }
    return '';
  }
}
