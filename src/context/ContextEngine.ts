/**
 * ContextEngine.ts — The hivemind brain.
 *
 * Principle: CONTEXT IS MEANING.
 *
 * This engine connects every data source in the plugin:
 *   - Vault notes (indexed discourse patterns per file)
 *   - Dictionary entries (Yomitan)
 *   - Surfer collocation entries
 *   - Classic collocation store entries
 *   - Discourse grammar patterns (370+ patterns)
 *   - Sentence relations (cross-sentence coherence)
 *   - KWIC concordance lines
 *
 * For any given word, pattern, or concept, the engine can produce:
 *   1. All vault notes where it appears (with surrounding context)
 *   2. Dictionary definitions (if imported)
 *   3. Saved collocations containing it
 *   4. Discourse patterns detected in its vicinity
 *   5. Example sentences from all sources
 *   6. Co-occurring patterns (what grammar often appears alongside it)
 *   7. Sentence-level relations (how it connects to neighboring clauses)
 *
 * Everything is queryable and renderable in a unified "context card."
 */

import type { App, TFile } from 'obsidian';
import type { DictionaryStore } from '../dictionary/DictionaryStore';
import type { CollocationStore } from '../data/CollocationStore';
import type { SurferBridge } from '../surfer-bridge';
import type { XCorpusStore } from '../x/XCorpusStore';
import { emptyQuery } from '../x/x-types';
import type { DictLookupResult } from '../dictionary/types';
import type { CollocationEntry } from '../types';
import type { SurferCollocationEntry } from '../surfer-types';
import type { OccurrenceRecord } from '../discourse/discourse-index';
import { detectPatterns, analyzeUtterance, CATEGORY_LABELS, CATEGORY_COLORS } from '../discourse/discourse-grammar';
import { type SentenceRelation } from '../discourse/sentence-relations';
import { makeRelationsResolver, type RelationsResolver } from '../discourse/relations-resolver';
import type { PatternMatch } from '../discourse/discourse-grammar';
import type { PatternCategory } from '../discourse/discourse-patterns';
import { PATTERN_BY_ID } from '../discourse/discourse-patterns';

// ══════════════════════════════════════════════════════════════
// TYPES — unified context results
// ══════════════════════════════════════════════════════════════

/** A vault occurrence: a note where a term/pattern appears with surrounding text */
export interface VaultOccurrence {
  filePath: string;
  /** Display name (note title without path/extension) */
  fileName: string;
  /** Surrounding text snippet (±80 chars) */
  context: string;
  /** Character offset in file */
  offset: number;
  /** Discourse patterns detected in the same paragraph */
  nearbyPatterns: string[];
  /** Timestamp of indexing */
  indexedAt: number;
}

/** An example from any source */
export interface UnifiedExample {
  text: string;
  source: 'vault' | 'dictionary' | 'collocation' | 'surfer' | 'manual' | 'x';
  sourceDetail: string; // file path, dict name, entry id
  /** Discourse patterns detected within this example */
  patterns: PatternMatch[];
  /** Relations found between clauses */
  relations: SentenceRelation[];
}

/** Full context for a single term/pattern */
export interface ContextCard {
  /** The query that produced this card */
  query: string;
  queryType: 'word' | 'pattern' | 'collocation' | 'concept';

  /** Dictionary results if any */
  dictResults: DictLookupResult[];

  /** Classic collocation store entries */
  collocations: CollocationEntry[];

  /** Surfer-originated entries */
  surferEntries: SurferCollocationEntry[];

  /** All examples unified from all sources, deduplicated, richly annotated */
  examples: UnifiedExample[];

  /** Vault notes where this appears */
  vaultOccurrences: VaultOccurrence[];

  /** Co-occurring discourse patterns (what grammar appears alongside) */
  coPatterns: Array<{
    patternId: string;
    surface: string;
    category: string;
    count: number;
  }>;

  /**
   * Typed directional bit-relations from sidecar data (when available).
   * Each entry is a pair where the query appeared as source OR target,
   * with the paired endpoint surfaced. Empty when no sidecar covers the
   * query's files — callers fall back to `coPatterns` (surface PMI).
   */
  bitRelations: BitRelationCoOccurrence[];

  /** Stats */
  totalExamples: number;
  vaultNoteCount: number;
  patternCount: number;
}

/**
 * Typed directional bit-relation between two textual endpoints, sourced from
 * a pipeline-emitted sidecar. The query matched one endpoint; the paired
 * endpoint is surfaced for the user along with the relation label.
 *
 * Example: query "あの" matches as `source` in a `withdraw_and_reformulate`
 * pair whose `target` is "あの考えておるところでございます。" — telling
 * the learner this is a hesitation→commit construction.
 */
export interface BitRelationCoOccurrence {
  /** Deterministic pair identifier from sidecar. */
  pairId: string;
  /** Relation label (e.g. `withdraw_and_reformulate`, `related`). */
  label: string;
  /** Which side the query appeared on. */
  matchedRole: 'source' | 'target';
  /** Surface form of the source endpoint (NFC). */
  sourceSurface: string;
  /** Surface form of the target endpoint (NFC). */
  targetSurface: string;
  /** Pipeline reconciliation outcome (locked / top_down_only / bottom_up_only). */
  reconciliation?: string;
  /** 0..1 confidence from the pipeline, if provided. */
  confidence?: number;
  /** Hash of the file this pair came from. */
  textHash: string;
}

/** A discourse grammar context card — shows all vault usages of a specific pattern */
export interface PatternContextCard {
  patternId: string;
  surface: string;
  category: PatternCategory;
  categoryLabel: string;
  categoryColor: string;
  gloss: string;
  glossEn: string;
  register: string;
  frequencyTier: number;

  /** All vault occurrences */
  vaultOccurrences: VaultOccurrence[];
  /** KWIC lines */
  kwicLines: Array<{ left: string; match: string; right: string; file: string }>;
  /** Co-occurring patterns */
  coPatterns: Array<{ patternId: string; surface: string; count: number }>;
  /** Example sentences from all sources */
  examples: UnifiedExample[];
}

// ══════════════════════════════════════════════════════════════
// CONTEXT ENGINE
// ══════════════════════════════════════════════════════════════

export class ContextEngine {
  private app: App;
  private dictStore: DictionaryStore;
  private collocationStore: CollocationStore;
  private surferBridge: SurferBridge;
  /** X tweet corpus — contributes real-usage examples when present. */
  private xCorpus: XCorpusStore | null;

  /** Sidecar-aware relations resolver, built from the bridge at construction. */
  private resolver: RelationsResolver;

  /** Cache of file content for fast context lookups */
  private contentCache: Map<string, string> = new Map();
  private cacheTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    app: App,
    dictStore: DictionaryStore,
    collocationStore: CollocationStore,
    surferBridge: SurferBridge,
    xCorpus: XCorpusStore | null = null,
  ) {
    this.app = app;
    this.dictStore = dictStore;
    this.collocationStore = collocationStore;
    this.surferBridge = surferBridge;
    this.xCorpus = xCorpus;
    this.resolver = makeRelationsResolver(surferBridge);
  }

  // ── Main query: get full context for any term ──────────

  async getContext(query: string): Promise<ContextCard> {
    const card: ContextCard = {
      query,
      queryType: this.classifyQuery(query),
      dictResults: [],
      collocations: [],
      surferEntries: [],
      examples: [],
      vaultOccurrences: [],
      coPatterns: [],
      bitRelations: [],
      totalExamples: 0,
      vaultNoteCount: 0,
      patternCount: 0,
    };

    // 1. Dictionary lookup
    card.dictResults = this.dictStore.lookup(query);

    // 2. Classic collocation search
    const allEntries = this.collocationStore.exportAll();
    card.collocations = allEntries.filter(e =>
      e.headword === query || e.collocate === query || e.fullPhrase.includes(query)
    );

    // 3. Surfer entries
    card.surferEntries = this.surferBridge.searchByMarker(query);
    // Also search by surface match
    for (const e of this.surferBridge.getAllEntries()) {
      if (e.surface === query && !card.surferEntries.includes(e)) {
        card.surferEntries.push(e);
      }
    }

    // 4. Vault-wide search
    card.vaultOccurrences = await this.searchVault(query);
    card.vaultNoteCount = new Set(card.vaultOccurrences.map(o => o.filePath)).size;

    // 5. Collect all examples from all sources
    card.examples = this.collectExamples(query, card);

    // 5b. X corpus usage examples (real tweets containing the query)
    if (this.xCorpus && this.xCorpus.size() > 0) {
      const seen = new Set(card.examples.map(e => e.text));
      const xq = { ...emptyQuery('', 'Latest' as const), allTerms: [query] };
      for (const tw of this.xCorpus.search(xq, 8)) {
        if (seen.has(tw.text)) continue;
        seen.add(tw.text);
        card.examples.push({
          text: tw.text,
          source: 'x',
          sourceDetail: tw.url,
          patterns: detectPatterns(tw.text),
          relations: [],
        });
      }
    }
    card.totalExamples = card.examples.length;

    // 6. Co-occurring patterns from the discourse index
    card.coPatterns = this.getCoPatterns(query);
    card.patternCount = card.coPatterns.length;

    // 7. Typed directional bit-relations from sidecar data (additive channel).
    card.bitRelations = this.getBitRelations(query);

    return card;
  }

  // ── Pattern-specific context card ──────────────────────

  async getPatternContext(patternId: string): Promise<PatternContextCard | null> {
    const pattern = PATTERN_BY_ID.get(patternId);
    if (!pattern) return null;

    const vaultOccurrences = await this.searchVault(pattern.surface);

    // KWIC lines from the index
    const kwicResult = this.surferBridge.searchKWIC(patternId);
    const kwicLines = kwicResult.records.map(r => ({
      left: r.left,
      match: r.keyword,
      right: r.right,
      file: r.filePath,
    }));

    // Co-occurring patterns
    const coPatterns = this.getCoPatterns(pattern.surface);

    // Collect examples
    const examples: UnifiedExample[] = [];
    for (const occ of vaultOccurrences) {
      if (occ.context.length > 10) {
        examples.push({
          text: occ.context,
          source: 'vault',
          sourceDetail: occ.filePath,
          patterns: detectPatterns(occ.context),
          relations: this.resolver(occ.context, { filePath: occ.filePath }).relations,
        });
      }
    }

    return {
      patternId,
      surface: pattern.surface,
      category: pattern.category,
      categoryLabel: CATEGORY_LABELS[pattern.category] ?? pattern.category,
      categoryColor: CATEGORY_COLORS[pattern.category] ?? '#95a5a6',
      gloss: pattern.gloss,
      glossEn: pattern.glossEn,
      register: pattern.register,
      frequencyTier: pattern.frequencyTier,
      vaultOccurrences,
      kwicLines,
      coPatterns,
      examples,
    };
  }

  // ── Vault-wide text search (performance-optimized) ─────

  async searchVault(query: string): Promise<VaultOccurrence[]> {
    const occurrences: VaultOccurrence[] = [];
    const files = this.app.vault.getMarkdownFiles();

    // Limit total results for performance
    const maxTotal = 50;
    const maxPerFile = 5;
    let fileCount = 0;

    for (const file of files) {
      if (occurrences.length >= maxTotal) break;

      // Skip very large files on mobile
      const stat = (file as any).stat;
      if (stat && stat.size > 100_000) continue;

      try {
        const content = await this.getCachedContent(file);
        // Quick check: if query not present, skip entirely (fast indexOf)
        if (!content.includes(query)) continue;

        let start = 0;
        let perFile = 0;
        while (perFile < maxPerFile) {
          const idx = content.indexOf(query, start);
          if (idx === -1) break;

          const contextStart = Math.max(0, idx - 80);
          const contextEnd = Math.min(content.length, idx + query.length + 80);
          const context = content.slice(contextStart, contextEnd);

          // Only run pattern detection on the first hit per file (expensive)
          let nearbyPatterns: string[] = [];
          if (perFile === 0) {
            const paraStart = content.lastIndexOf('\n', idx) + 1;
            const paraEnd = content.indexOf('\n', idx + query.length);
            const paragraph = content.slice(paraStart, paraEnd === -1 ? undefined : paraEnd);
            nearbyPatterns = detectPatterns(paragraph).map(m => m.pattern.id);
          }

          occurrences.push({
            filePath: file.path,
            fileName: file.basename,
            context,
            offset: idx,
            nearbyPatterns,
            indexedAt: Date.now(),
          });

          start = idx + 1;
          perFile++;
        }
        fileCount++;
      } catch {
        // Skip unreadable files
      }
    }

    return occurrences;
  }

  // ── Collect examples from all sources ──────────────────

  private collectExamples(query: string, card: ContextCard): UnifiedExample[] {
    const examples: UnifiedExample[] = [];
    const seen = new Set<string>();

    // From collocations
    for (const e of card.collocations) {
      for (const ex of e.exampleSentences) {
        if (seen.has(ex)) continue;
        seen.add(ex);
        examples.push({
          text: ex,
          source: 'collocation',
          sourceDetail: e.id,
          patterns: detectPatterns(ex),
          relations: this.resolver(ex).relations,
        });
      }
    }

    // From surfer entries
    for (const e of card.surferEntries) {
      for (const ex of e.exampleSentences ?? []) {
        if (seen.has(ex.text)) continue;
        seen.add(ex.text);
        examples.push({
          text: ex.text,
          source: 'surfer',
          sourceDetail: ex.source,
          patterns: detectPatterns(ex.text),
          relations: this.resolver(ex.text, { filePath: ex.source }).relations,
        });
      }
      // Also add discourse context chunk texts
      for (const ctx of e._discourseContexts ?? []) {
        if (ctx.chunkText && !seen.has(ctx.chunkText)) {
          seen.add(ctx.chunkText);
          examples.push({
            text: ctx.chunkText,
            source: 'surfer',
            sourceDetail: ctx.sourceFile,
            patterns: detectPatterns(ctx.chunkText),
            relations: this.resolver(ctx.chunkText, { filePath: ctx.sourceFile }).relations,
          });
        }
      }
    }

    // From vault occurrences (larger context)
    for (const occ of card.vaultOccurrences.slice(0, 20)) {
      // Use the surrounding context as an example
      if (occ.context.length > 15 && !seen.has(occ.context)) {
        seen.add(occ.context);
        examples.push({
          text: occ.context,
          source: 'vault',
          sourceDetail: occ.filePath,
          patterns: detectPatterns(occ.context),
          relations: this.resolver(occ.context, { filePath: occ.filePath }).relations,
        });
      }
    }

    return examples;
  }

  // ── Co-occurring patterns ──────────────────────────────

  private getCoPatterns(query: string): ContextCard['coPatterns'] {
    const patternCounts = new Map<string, number>();

    // ONE KWIC search for the query, then count patterns per file that
    // contains it. (This used to re-run the full KWIC search once per indexed
    // file — O(files × search) — the main reason context cards crawled on
    // large vaults.)
    const kwic = this.surferBridge.searchKWICContext(query);
    const filesWithQuery = new Set(kwic.records.map(r => r.filePath));
    for (const fp of filesWithQuery) {
      for (const pid of this.surferBridge.getFilePatterns(fp)) {
        patternCounts.set(pid, (patternCounts.get(pid) ?? 0) + 1);
      }
    }

    return [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([patternId, count]) => {
        const p = PATTERN_BY_ID.get(patternId);
        return {
          patternId,
          surface: p?.surface ?? patternId,
          category: p?.category ?? '?',
          count,
        };
      });
  }

  // ── Typed bit-relations (sidecar-backed) ───────────────

  /**
   * Surface typed directional pair relations from sidecar data. Empty when
   * no sidecar covers any currently-indexed file containing the query.
   * This is purely additive — `getCoPatterns` (surface PMI) continues to
   * run alongside as the universal fallback.
   */
  private getBitRelations(query: string): BitRelationCoOccurrence[] {
    const index = this.surferBridge.getBitRelationIndex();
    const hits = index.findPairsContainingSurface(query);
    if (hits.length === 0) return [];

    // Sort: locked > top_down_only > bottom_up_only, then by confidence desc,
    // then by source charStart for stability.
    const reconRank: Record<string, number> = {
      locked: 0,
      top_down_only: 1,
      bottom_up_only: 2,
    };
    const ranked = hits.slice().sort((a, b) => {
      const ra = reconRank[a.pair.source.reconciliation ?? ''] ?? 9;
      const rb = reconRank[b.pair.source.reconciliation ?? ''] ?? 9;
      if (ra !== rb) return ra - rb;
      const ca = a.pair.source.confidence ?? 0;
      const cb = b.pair.source.confidence ?? 0;
      if (ca !== cb) return cb - ca;
      return a.pair.source.charStart - b.pair.source.charStart;
    });

    return ranked.slice(0, 20).map(h => ({
      pairId: h.pair.pairId,
      label: h.pair.source.label,
      matchedRole: h.matchedRole,
      sourceSurface: h.sourceSurface,
      targetSurface: h.targetSurface,
      reconciliation: h.pair.source.reconciliation,
      confidence: h.pair.source.confidence,
      textHash: h.pair.textHash,
    }));
  }

  // ── File content caching ───────────────────────────────

  private async getCachedContent(file: TFile): Promise<string> {
    if (this.contentCache.has(file.path)) {
      return this.contentCache.get(file.path)!;
    }
    const content = await this.app.vault.cachedRead(file);
    this.contentCache.set(file.path, content);

    // Auto-expire cache after 30s
    if (!this.cacheTimer) {
      this.cacheTimer = setTimeout(() => {
        this.contentCache.clear();
        this.cacheTimer = null;
      }, 30000);
    }
    return content;
  }

  /** Get list of indexed files (delegate to surfer bridge) */
  getIndexedFiles(): string[] {
    return this.surferBridge.getIndexedFiles();
  }

  /** Get patterns for a file */
  getFilePatterns(filePath: string): string[] {
    return this.surferBridge.getFilePatterns(filePath);
  }

  /** Get index stats */
  getIndexStats() {
    return this.surferBridge.getStats();
  }

  // ── Helpers ────────────────────────────────────────────

  private classifyQuery(query: string): ContextCard['queryType'] {
    // Check if it matches a pattern ID
    if (PATTERN_BY_ID.get(query)) return 'pattern';
    // Check if it's a known collocation
    const entries = this.collocationStore.exportAll();
    if (entries.some(e => e.fullPhrase === query)) return 'collocation';
    return 'word';
  }
}
