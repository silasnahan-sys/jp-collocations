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
import { buildNeighborIndex, neighborsOf, type NavHeadword, type NeighborIndex } from './dict-nav';

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

  /**
   * Terms above which a dictionary must NOT live in the plugin data blob.
   *
   * Learned the hard way on 2026-07-25: a large import pushed `_dictStore` to
   * **239.6 MB of a 241 MB blob**, the whole-file rewrite was truncated
   * mid-string, and the plugin then failed to load at all (the view opened for
   * a second and went white). AUDIT §18 had already flagged the blob; this is
   * the same failure, an order of magnitude worse. Big dictionaries belong in
   * vault sidecars (DESIGN §27.5, `sidecar.ts` — one shard read per lookup, no
   * blob involvement at all).
   */
  static readonly BLOB_TERM_LIMIT = 120_000;

  /** Dictionaries too big for the blob — reported, never silently dropped. */
  oversized(): Array<{ title: string; terms: number }> {
    const out: Array<{ title: string; terms: number }> = [];
    for (const d of this.dictionaries.values()) {
      if (d.terms.length > DictionaryStore.BLOB_TERM_LIMIT) {
        out.push({ title: d.meta.title, terms: d.terms.length });
      }
    }
    return out;
  }

  async save(): Promise<void> {
    const serialized: SerializedDictionary[] = [];
    for (const dict of this.dictionaries.values()) {
      // Refuse to write a dictionary that would blow up the blob. Skipping it
      // here means it lives only in memory for this session and is gone on
      // reload — which is strictly better than a 240MB blob that cannot be
      // parsed and takes the whole plugin down with it. `oversized()` lets the
      // caller say so in place (§28 S6), and the sidecar path is the real home.
      if (dict.terms.length > DictionaryStore.BLOB_TERM_LIMIT) continue;
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

  // ── Neighbours (dict-nav.ts) ───────────────────────────────
  //
  // The dictionary as a walkable order: every headword has a left and a right
  // neighbour in reading (gojūon) order, like a page in a physical book —
  // Monokakido's bottom-corner chips (コマ送り item 8). The index is built
  // lazily and keyed on (enabled set × installed set), so importing, removing
  // or toggling a dictionary self-invalidates without any hook wiring; term
  // data inside a dictionary never mutates after install, so the key is
  // sufficient. Cost: one flatten + sort per mutation, milliseconds at the
  // blob cap (120k terms), never per lookup.
  private navCache: { key: string; index: NeighborIndex } | null = null;

  neighbors(query: string): ReturnType<typeof neighborsOf> {
    const q = normalizeJapanese(query.trim());
    if (!q) return null;
    // Mirror lookupSurface exactly: only ENABLED dictionaries are places.
    const enabled = this.settings.enabledDictionaries.filter(t => this.dictionaries.has(t));
    const key = [...enabled].sort().join('\u0001');
    if (!this.navCache || this.navCache.key !== key) {
      const entries: NavHeadword[] = [];
      for (const title of enabled) {
        const dict = this.dictionaries.get(title);
        if (!dict) continue;
        for (const t of dict.terms) entries.push({ expression: t.expression, reading: t.reading });
      }
      this.navCache = { key, index: buildNeighborIndex(entries) };
    }
    return neighborsOf(this.navCache.index, q);
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

  /**
   * Exact-surface EXISTENCE test — no result assembly, no deinflection
   * fallback. §29 rung 0's oracle asks this thousands of times per keystroke
   * (every extension probe of every occurrence), and almost every probe is a
   * miss; `lookup()` answers a miss by running the whole deinflection
   * fallback, which is pure waste when the question is only "is this surface
   * a headword". Same truth as `lookup(s).some(r => !r.deinflection)`,
   * measured severalfold cheaper on misses.
   */
  hasExactSurface(query: string): boolean {
    const normalized = normalizeJapanese(query.trim());
    if (!normalized) return false;
    const hiragana = toHiragana(normalized);
    for (const title of this.settings.enabledDictionaries) {
      const dict = this.dictionaries.get(title);
      if (!dict) continue;
      if (dict.expressionIndex.has(normalized)) return true;
      if (dict.readingIndex.has(normalized)) return true;
      if (hiragana !== normalized && dict.readingIndex.has(hiragana)) return true;
    }
    return false;
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
   * Monokakido's Ends mode, spoken in the plugin's own alphabet: the query
   * 〜たなら means "headwords and readings that END in たなら" — the same 〜
   * every notation in the catalog already uses for "material before this".
   * (X〜 is Starts, and prefixSearch already answers it.) The reading scan is
   * what makes びを find 口火を切る — the reading-substring-across-idioms row
   * of the gap list. One pass over the index keys; the keys are the corpus.
   */
  endsWithSearch(suffix: string, limit = 40): DictLookupResult[] {
    const normalized = normalizeJapanese(suffix.trim());
    if (!normalized) return [];
    const hiragana = toHiragana(normalized);
    const results: DictLookupResult[] = [];
    const seen = new Set<string>();
    const take = (dict: DictionaryData, dictTitle: string, ids: number[]): boolean => {
      for (const id of ids) {
        const term = dict.terms[id];
        if (!term) continue;
        const key = `${term.expression}|${term.reading}|${dictTitle}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ term, dictionary: dictTitle, tags: [], frequency: dict.frequencies.get(term.expression) });
        if (results.length >= limit) return true;
      }
      return false;
    };
    for (const dictTitle of this.settings.enabledDictionaries) {
      const dict = this.dictionaries.get(dictTitle);
      if (!dict) continue;
      for (const [expr, ids] of dict.expressionIndex) {
        if ((expr.endsWith(normalized) || expr.endsWith(hiragana)) && take(dict, dictTitle, ids)) return results;
      }
      for (const [read, ids] of dict.readingIndex) {
        if ((read.endsWith(normalized) || read.endsWith(hiragana)) && take(dict, dictTitle, ids)) return results;
      }
    }
    return results;
  }

  /**
   * Homophone paging (gap-list item 6): the other words that SOUND like this
   * one — 決行 → 血行・結構, Monokakido's あさ/あした/ちょう pages for 朝.
   * The readings of the query's exact hits fan out through the readingIndex;
   * every expression sharing one is a page beside this page.
   */
  homophones(query: string, cap = 8): Array<{ expression: string; reading: string }> {
    const normalized = normalizeJapanese(query.trim());
    if (!normalized) return [];
    const hiragana = toHiragana(normalized);
    const readings = new Set<string>();
    for (const dictTitle of this.settings.enabledDictionaries) {
      const dict = this.dictionaries.get(dictTitle);
      if (!dict) continue;
      const ids = dict.expressionIndex.get(normalized);
      if (ids) for (const id of ids) { const t = dict.terms[id]; if (t?.reading) readings.add(toHiragana(t.reading)); }
      // the query may itself BE a reading (typed in kana)
      if (dict.readingIndex.has(normalized)) readings.add(hiragana);
      else if (hiragana !== normalized && dict.readingIndex.has(hiragana)) readings.add(hiragana);
    }
    if (!readings.size) return [];
    const out: Array<{ expression: string; reading: string }> = [];
    const seen = new Set<string>([normalized]);
    for (const dictTitle of this.settings.enabledDictionaries) {
      const dict = this.dictionaries.get(dictTitle);
      if (!dict) continue;
      for (const r of readings) {
        const ids = dict.readingIndex.get(r);
        if (!ids) continue;
        for (const id of ids) {
          const t = dict.terms[id];
          if (!t || seen.has(t.expression)) continue;
          seen.add(t.expression);
          out.push({ expression: t.expression, reading: t.reading });
          if (out.length >= cap) return out;
        }
      }
    }
    return out;
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
