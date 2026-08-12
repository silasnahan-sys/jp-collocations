import { Notice, type App } from "obsidian";
import type {
  SurferCollocationEntry,
  DiscourseContext,
  DiscourseCategory,
  CollocationMatch,
  DiscourseStats,
  AnalysisResult,
  VariationTreeResult,
  KWICResult,
  ConstellationResult,
  VaultProfileResult,
  TranscriptAnalysisResult,
} from "./surfer-types";

// Discourse engine imports
import { detectPatterns, detectLogicalFlows, analyzeUtterance, buildDiscourseProfile, segmentAtBoundaries, CATEGORY_LABELS, analyzeTranscript, smartAnalyze, isTranscriptFormat, cleanForAnalysis, cleanSelection } from "./discourse/discourse-grammar";
import { DiscourseIndex, type DiscourseIndexData } from "./discourse/discourse-index";
import { KWICIndex, type KWICIndexData } from "./discourse/occurrence-index";
import { buildConstellation, getStrongestAssociations, type Constellation } from "./discourse/co-occurrence";
import { buildVariationTrees, getTreeForPattern, getRegisterProgression, type VariationTree } from "./discourse/variation-trees";
import { matchTemplates } from "./discourse/cooperation-templates";
import { PATTERN_BY_ID, ALL_PATTERNS, PATTERN_COUNT } from "./discourse/discourse-patterns";
import type { PatternMatch } from "./discourse/discourse-grammar";
import { BitRelationIndex } from "./discourse/bit-relation-index";
import { loadSidecarForFile, type SidecarLoadOutcome } from "./discourse/sidecar-loader";

// ── Persist function type ────────────────────────────────────

interface SurferBridgeData {
  entries: Record<string, SurferCollocationEntry>;
  discourseIndex?: DiscourseIndexData;
  kwicIndex?: KWICIndexData;
  /** Which pattern engine built the persisted indexes (see ENGINE_INDEX_VERSION). */
  engineVersion?: number;
}

/**
 * Bumped when the pattern detector changes in a way that invalidates the
 * persisted indexes. v2 = PARSER-AUDIT Phase 2 (boundary-aware engine).
 * Indexes persisted with an older/absent version were built by the legacy
 * substring scanner (≈13% false positives) — on load they are DROPPED and
 * the vault reindexes in the background rather than serving wrong data.
 */
const ENGINE_INDEX_VERSION = 2;

type PersistFn = (data: SurferBridgeData) => Promise<void>;

/**
 * SurferBridge manages surfer-originated entries + full discourse analysis.
 *
 * Integrates all 6 discourse engines:
 *   1. Pattern detection (discourse-grammar)
 *   2. 5-axis inverted index (discourse-index)
 *   3. KWIC concordance (occurrence-index)
 *   4. Co-occurrence constellations (co-occurrence)
 *   5. Variation trees (variation-trees)
 *   6. Cooperation templates (cooperation-templates)
 */
export class SurferBridge {
  private entries: Map<string, SurferCollocationEntry> = new Map();
  private persistFn: PersistFn;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  // Discourse subsystems
  private discourseIndex: DiscourseIndex;
  private kwicIndex: KWICIndex;
  private variationTrees: VariationTree[] | null = null;
  private constellation: Constellation | null = null;
  /**
   * filePath → that file's matches. Keyed BY FILE, and that is the whole point.
   *
   * This was an array that `indexFile` pushed onto. Re-indexing a file — which
   * happens whenever it is edited, and used to happen on every leaf change —
   * appended a second copy of its matches instead of replacing the first, so
   * the constellation counted the same utterances two, five, forty times and
   * called the result a co-occurrence frequency. The array also never shrank,
   * on a path that could fire indefinitely.
   *
   * A map keyed by the thing that owns the data makes re-indexing idempotent
   * by construction, and lets `removeFileFromIndex` actually remove it — which
   * it could not do before, so a deleted file kept voting.
   */
  private utterancesByFile: Map<string, PatternMatch[]> = new Map();

  // Sidecar-backed typed-relation index. Populated lazily when files are
  // indexed via indexFileWithSidecar(). When the active file has no sidecar,
  // consumers fall back to surface-window PMI (graceful degradation).
  private bitRelationIndex: BitRelationIndex = new BitRelationIndex();
  // filePath → canonical NFC text hash. Lets consumers ask `getBitRelationsFor(file)`
  // without re-hashing.
  private fileHashes: Map<string, string> = new Map();
  // filePath → raw file text as last indexed. Kept in-memory only (not persisted)
  // so the relations resolver can substring-locate chunks within their source file
  // when translating sidecar NFC offsets to chunk-local offsets.
  private rawTextByFile: Map<string, string> = new Map();
  // Most recent sidecar outcome per file (diagnostics / status bar).
  private lastSidecarOutcome: Map<string, SidecarLoadOutcome> = new Map();
  private app?: App;

  /** True when load() dropped legacy-built indexes; main.ts triggers a reindex. */
  needsReindex = false;

  constructor(persistFn: PersistFn, app?: App) {
    this.persistFn = persistFn;
    this.app = app;
    this.discourseIndex = new DiscourseIndex();
    this.kwicIndex = new KWICIndex();
  }

  // ── Bootstrap ────────────────────────────────────────────

  /** Restore all state from the plugin-data blob. */
  load(raw: SurferBridgeData | undefined): void {
    this.entries.clear();
    // Indexes are MEMORY-ONLY (AUDIT §1.2): persisted index blobs were 99.5%
    // of the historical 62MB data.json and are derived data — they are never
    // deserialized (legacy ones were contaminated anyway, see
    // ENGINE_INDEX_VERSION) and never written again. Entries are the only
    // durable state; the vault reindexes idle-batched in the background.
    this.needsReindex = true;
    if (!raw) return;

    // Entries
    if (raw.entries) {
      for (const [id, entry] of Object.entries(raw.entries)) {
        if (id && entry && typeof entry.surface === "string") {
          this.entries.set(id, entry);
        }
      }
    }
  }

  /**
   * Drop both pattern indexes and derived caches (manual "rebuild indexes").
   * Callers should follow up with a vault reindex.
   */
  purgeIndexes(): void {
    this.discourseIndex = new DiscourseIndex();
    this.kwicIndex = new KWICIndex();
    this.utterancesByFile.clear();
    this.constellation = null;
    this.variationTrees = null;
    this.rawTextByFile.clear();
    this.schedulePersist();
  }

  /** Durable state only — entries. Indexes are memory-only (see load()). */
  serialize(): SurferBridgeData {
    const entries: Record<string, SurferCollocationEntry> = {};
    for (const [id, entry] of this.entries) {
      entries[id] = entry;
    }
    return { entries, engineVersion: ENGINE_INDEX_VERSION };
  }

  // ══════════════════════════════════════════════════════════
  // WRITE METHODS (auto-persist)
  // ══════════════════════════════════════════════════════════

  async addEntry(entry: SurferCollocationEntry): Promise<void> {
    if (!entry.id || !entry.surface) return;
    this.entries.set(entry.id, { ...entry });
    new Notice(`Surfer → 「${entry.surface}」 saved`);
    await this.schedulePersist();
  }

  async addDiscourseContext(id: string, ctx: DiscourseContext): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) {
      new Notice(`Surfer bridge: entry ${id} not found`);
      return;
    }
    if (!entry._discourseContexts) entry._discourseContexts = [];
    entry._discourseContexts.push(ctx);
    new Notice(`Discourse context added to 「${entry.surface}」`);
    await this.schedulePersist();
  }

  async saveExampleSentence(id: string, text: string, source: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) {
      new Notice(`Surfer bridge: entry ${id} not found`);
      return;
    }
    if (!entry.exampleSentences) entry.exampleSentences = [];
    if (entry.exampleSentences.some(s => s.text === text)) return;
    entry.exampleSentences.push({ text, source });
    new Notice(`Example saved → 「${entry.surface}」`);
    await this.schedulePersist();
  }

  // ══════════════════════════════════════════════════════════
  // DISCOURSE ANALYSIS (the core new capabilities)
  // ══════════════════════════════════════════════════════════

  /**
   * Full discourse analysis of a text passage.
   * Called by surfer when user activates discourse mode on selected text.
   */
  analyzeText(text: string): AnalysisResult {
    const analysis = analyzeUtterance(text);
    const templates = matchTemplates(analysis.patterns);

    return {
      patterns: analysis.patterns,
      flows: analysis.flows.map(f => ({
        flowName: f.flow.name,
        flowNameEn: f.flow.nameEn,
        matchCount: f.matches.length,
      })),
      templates: templates.map(t => ({
        templateName: t.template.name,
        confidence: t.confidence,
      })),
      register: analysis.estimatedRegister,
      dominantFunctions: analysis.dominantFunctions,
      categoryBreakdown: analysis.categoryBreakdown as Record<string, number>,
    };
  }

  /**
   * Index a file's discourse patterns.
   * Auto-detects transcript format and cleans timestamps/URLs before analysis.
   * Called when a file is opened or modified (with debounce from main.ts).
   */
  indexFile(filePath: string, content: string): void {
    // Clean transcript formatting before pattern detection
    const cleanContent = isTranscriptFormat(content)
      ? cleanForAnalysis(content)
      : content;

    // Cache cleaned raw text for the relations resolver. Note: we store the
    // *cleaned* content because that's what the Python pipeline also hashes —
    // sidecar offsets are relative to the cleaned form, so chunk-substring
    // lookups must use the same.
    this.rawTextByFile.set(filePath, cleanContent);

    const matches = detectPatterns(cleanContent);
    this.discourseIndex.indexFile(filePath, cleanContent, matches);
    this.kwicIndex.indexFile(filePath, cleanContent, matches);

    // Cache for constellation building — replaces this file's previous
    // contribution rather than adding to it.
    this.utterancesByFile.set(filePath, matches);
    // Invalidate constellation cache
    this.constellation = null;

    // Link any collocations in this file
    for (const entry of this.entries.values()) {
      if (entry.sourceFile === filePath) {
        const patternIds = matches.map(m => m.pattern.id);
        this.discourseIndex.linkCollocation(entry.surface, patternIds);
      }
    }

    this.schedulePersist();
  }

  /** Remove a file from the index */
  removeFileFromIndex(filePath: string): void {
    this.discourseIndex.removeFile(filePath);
    this.kwicIndex.removeFile(filePath);
    const prevHash = this.fileHashes.get(filePath);
    if (prevHash) {
      this.bitRelationIndex.clearForHash(prevHash);
      this.fileHashes.delete(filePath);
    }
    this.rawTextByFile.delete(filePath);
    this.lastSidecarOutcome.delete(filePath);
    // A removed file must stop voting in the constellation. With the old
    // append-only array there was no way to find its contribution, so it never
    // did — every deleted or renamed note kept counting forever.
    if (this.utterancesByFile.delete(filePath)) this.constellation = null;
    this.schedulePersist();
  }

  /**
   * Sidecar-aware indexing. Performs the same work as `indexFile`, then
   * attempts to load `<vault>/.obsidian/plugins/jp-collocations/analysis/<hash>.json`
   * and populate the BitRelationIndex. Falls back silently when no sidecar is
   * present or when the App reference was not supplied at construction time.
   *
   * Safe to call without awaiting — the sync `indexFile` work completes
   * before the await suspends, so discourse/KWIC indexes are populated
   * synchronously. The promise resolves once the sidecar attempt finishes.
   */
  async indexFileWithSidecar(filePath: string, content: string): Promise<SidecarLoadOutcome | null> {
    this.indexFile(filePath, content);
    if (!this.app) return null;

    // Drop any prior sidecar data for this file (hash may have changed).
    const prevHash = this.fileHashes.get(filePath);
    if (prevHash) this.bitRelationIndex.clearForHash(prevHash);

    const outcome = await loadSidecarForFile(this.app, content, this.bitRelationIndex);
    this.fileHashes.set(filePath, outcome.textHash);
    this.lastSidecarOutcome.set(filePath, outcome);
    return outcome;
  }

  /** Access to the typed-relation index for downstream consumers (e.g. ContextEngine). */
  getBitRelationIndex(): BitRelationIndex {
    return this.bitRelationIndex;
  }

  /** Canonical NFC text hash for a file we've indexed via the sidecar path. */
  getTextHashForFile(filePath: string): string | undefined {
    return this.fileHashes.get(filePath);
  }

  /**
   * Cleaned raw text for a file we've indexed. Returns undefined if not
   * indexed. Used by the relations resolver to substring-locate chunks.
   */
  getRawTextForFile(filePath: string): string | undefined {
    return this.rawTextByFile.get(filePath);
  }

  /** Most recent sidecar load outcome for a file (for status-bar / diagnostics). */
  getSidecarOutcome(filePath: string): SidecarLoadOutcome | undefined {
    return this.lastSidecarOutcome.get(filePath);
  }

  /**
   * Aggregate sidecar coverage stats across all files indexed this session.
   * Used by the status-bar indicator and the `sidecar-coverage` debug command.
   *
   * `indexed` is the count of files we have raw text cached for (i.e. seen via
   * indexFile / indexFileWithSidecar). `applied` is the subset whose sidecar
   * was successfully loaded into the BitRelationIndex. The remainder is broken
   * out by `reason` so the user can see *why* coverage isn't 100%.
   */
  getCoverageStats(): {
    indexed: number;
    applied: number;
    byReason: Record<string, number>;
    activeFile?: { path: string; applied: boolean; reason?: string };
  } {
    const indexed = this.rawTextByFile.size;
    let applied = 0;
    const byReason: Record<string, number> = {};
    for (const outcome of this.lastSidecarOutcome.values()) {
      if (outcome.applied) applied++;
      else {
        const r = outcome.reason ?? 'unknown';
        byReason[r] = (byReason[r] ?? 0) + 1;
      }
    }
    // Files that were indexed but never attempted via the sidecar path show
    // up here as 'not-attempted' (e.g. legacy indexFile() without App).
    const attemptedCount = this.lastSidecarOutcome.size;
    if (indexed > attemptedCount) {
      byReason['not-attempted'] = (byReason['not-attempted'] ?? 0) + (indexed - attemptedCount);
    }
    return { indexed, applied, byReason };
  }

  /**
   * Segment unsegmented text (like YT transcripts) at discourse boundaries.
   */
  segmentText(text: string): string[] {
    return segmentAtBoundaries(text);
  }

  // ══════════════════════════════════════════════════════════
  // QUERY METHODS
  // ══════════════════════════════════════════════════════════

  // ── Entry queries ────────────────────────────────────────

  findInText(text: string): CollocationMatch[] {
    const matches: CollocationMatch[] = [];
    for (const entry of this.entries.values()) {
      const surface = entry.surface;
      if (!surface) continue;
      let start = 0;
      while (true) {
        const idx = text.indexOf(surface, start);
        if (idx === -1) break;
        matches.push({ entry, offset: idx, length: surface.length });
        start = idx + 1;
      }
    }
    return matches.sort((a, b) => a.offset - b.offset);
  }

  searchByMarker(surface: string): SurferCollocationEntry[] {
    const results: SurferCollocationEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.surface === surface) {
        results.push(entry);
        continue;
      }
      if (entry._discourseContexts) {
        for (const ctx of entry._discourseContexts) {
          if (ctx.markers.some(m => m.surface === surface)) {
            results.push(entry);
            break;
          }
        }
      }
    }
    return results;
  }

  searchByCategory(category: DiscourseCategory | string): SurferCollocationEntry[] {
    return [...this.entries.values()].filter(
      e => e.discourseCategory === category
    );
  }

  getAllEntries(): SurferCollocationEntry[] {
    return [...this.entries.values()];
  }

  getAllEntriesMap(): Map<string, SurferCollocationEntry> {
    return new Map(this.entries);
  }

  // ── KWIC queries ─────────────────────────────────────────

  searchKWIC(patternId: string): KWICResult {
    return this.kwicIndex.getByPattern(patternId);
  }

  searchKWICBySurface(surface: string): KWICResult {
    return this.kwicIndex.getBySurface(surface);
  }

  searchKWICContext(query: string): KWICResult {
    const records = this.kwicIndex.searchContext(query);
    const files = new Set(records.map(r => r.filePath));
    return { records, totalCount: records.length, fileCount: files.size };
  }

  // ── Variation tree queries ───────────────────────────────

  getVariationTree(patternId: string): VariationTreeResult | null {
    if (!this.variationTrees) {
      this.variationTrees = buildVariationTrees();
    }
    const tree = getTreeForPattern(this.variationTrees, patternId);
    if (!tree) return null;

    return {
      stem: tree.stem,
      conceptLabel: tree.conceptLabel,
      conceptLabelEn: tree.conceptLabelEn,
      variants: getRegisterProgression(tree).map(v => ({
        surface: v.surface,
        register: v.register,
        pragmaticFunction: v.pragmaticFunction,
        frequencyTier: v.frequencyTier,
      })),
    };
  }

  getAllVariationTrees(): VariationTreeResult[] {
    if (!this.variationTrees) {
      this.variationTrees = buildVariationTrees();
    }
    return this.variationTrees.map(tree => ({
      stem: tree.stem,
      conceptLabel: tree.conceptLabel,
      conceptLabelEn: tree.conceptLabelEn,
      variants: tree.variants.map(v => ({
        surface: v.surface,
        register: v.register,
        pragmaticFunction: v.pragmaticFunction,
        frequencyTier: v.frequencyTier,
      })),
    }));
  }

  // ── Co-occurrence / constellation queries ────────────────

  getConstellationFor(patternId: string, limit: number = 5): ConstellationResult | null {
    this.ensureConstellation();
    if (!this.constellation) return null;

    const node = this.constellation.nodes.get(patternId);
    if (!node) return null;

    return {
      patternId: node.patternId,
      surface: node.surface,
      frequency: node.frequency,
      associations: getStrongestAssociations(this.constellation, patternId, limit),
    };
  }

  private ensureConstellation(): void {
    if (this.constellation || this.utterancesByFile.size === 0) return;
    this.constellation = buildConstellation([...this.utterancesByFile.values()]);
  }

  // ── Index queries ────────────────────────────────────────

  searchIndexBySurface(surface: string) {
    return this.discourseIndex.searchBySurface(surface);
  }

  searchIndexByCategory(category: string) {
    return this.discourseIndex.searchByCategory(category);
  }

  getTopCoOccurrencePairs(limit: number = 20) {
    return this.discourseIndex.getTopCoOccurrences(limit);
  }

  getFilePatterns(filePath: string) {
    return this.discourseIndex.getFilePatterns(filePath);
  }

  getIndexedFiles() {
    return this.discourseIndex.getIndexedFiles();
  }

  // ── Pattern database queries ─────────────────────────────

  getPatternById(id: string) {
    return PATTERN_BY_ID.get(id) ?? null;
  }

  searchPatterns(query: string) {
    const lower = query.toLowerCase();
    return ALL_PATTERNS.filter(p =>
      p.surface.includes(lower) ||
      p.gloss.includes(query) ||
      p.glossEn.toLowerCase().includes(lower) ||
      p.subcategory.includes(query) ||
      p.id.toLowerCase().includes(lower)
    );
  }

  getPatternCount(): number {
    // Live length: the engine adapter registers its operator defs at load,
    // so the module-init PATTERN_COUNT constant undercounts.
    return ALL_PATTERNS.length;
  }

  // ── Vault-wide profiling ─────────────────────────────────

  buildVaultProfile(texts: string[]): VaultProfileResult {
    // Clean transcript text before profiling
    const cleanTexts = texts.map(t =>
      isTranscriptFormat(t) ? cleanForAnalysis(t) : t
    );
    const profile = buildDiscourseProfile(cleanTexts);
    return {
      totalMatches: profile.totalMatches,
      topPatterns: profile.topPatterns.map(p => ({ surface: p.surface, count: p.count })),
      registerDistribution: profile.registerDistribution,
      formalityScore: profile.formalityScore,
      hedgingRatio: profile.hedgingRatio,
      flowCount: profile.flowCount,
    };
  }

  // ── Transcript analysis ──────────────────────────────────

  /**
   * Full transcript-aware analysis.
   * Auto-detects transcript format, parses speakers, merges turns,
   * and runs discourse analysis per-turn and per-speaker.
   */
  analyzeTranscriptText(text: string): TranscriptAnalysisResult {
    const result = analyzeTranscript(text);
    const agg = result.aggregateProfile;

    // Estimate register from aggregate
    const regEntries = Object.entries(agg.registerDistribution);
    const topReg = regEntries.length > 0
      ? regEntries.sort((a, b) => b[1] - a[1])[0][0]
      : 'neutral';

    return {
      isTranscript: true,
      cleanText: result.transcript.cleanText,
      speakerCount: result.transcript.speakerCount,
      durationSeconds: result.transcript.durationSeconds,
      turns: result.turnAnalyses.map(ta => ({
        speaker: ta.turn.speaker,
        startTimestamp: ta.turn.startTimestamp,
        text: ta.turn.text,
        patternCount: ta.analysis.patterns.length,
        dominantFunction: ta.analysis.dominantFunctions[0] ?? '',
        register: ta.analysis.estimatedRegister,
      })),
      speakerProfiles: result.speakerProfiles.map(sp => ({
        speaker: sp.speaker,
        turnCount: sp.turnCount,
        charCount: sp.charCount,
        topPatterns: sp.profile.topPatterns.slice(0, 5).map(p => ({
          surface: p.surface,
          count: p.count,
        })),
        formalityScore: sp.profile.formalityScore,
        register: estimateRegisterLabel(sp.profile.formalityScore),
      })),
      totalPatterns: agg.totalMatches,
      overallRegister: topReg,
      extractedUrls: result.transcript.extractedUrls,
      turnPairPatterns: result.turnPairPatterns,
    };
  }

  /**
   * Smart analysis: auto-detects transcript vs plain text.
   */
  smartAnalyzeText(text: string): AnalysisResult | TranscriptAnalysisResult {
    if (isTranscriptFormat(text)) {
      return this.analyzeTranscriptText(text);
    }
    return this.analyzeText(text);
  }

  /**
   * Clean a user selection that may contain timestamps.
   */
  cleanSelectionText(text: string): string {
    return cleanSelection(text);
  }

  /**
   * Check if text is transcript format.
   */
  isTranscript(text: string): boolean {
    return isTranscriptFormat(text);
  }

  // ── Stats ────────────────────────────────────────────────

  getStats(): DiscourseStats {
    const byCategory: Record<string, number> = {};
    const byPosition: Record<string, number> = {};
    const coOccurrenceCounts = new Map<string, number>();

    for (const entry of this.entries.values()) {
      if (entry.discourseCategory) {
        byCategory[entry.discourseCategory] = (byCategory[entry.discourseCategory] ?? 0) + 1;
      }
      if (entry.discoursePosition) {
        byPosition[entry.discoursePosition] = (byPosition[entry.discoursePosition] ?? 0) + 1;
      }
      if (entry.coOccurrenceIds && entry.coOccurrenceIds.length > 0) {
        for (const coId of entry.coOccurrenceIds) {
          const pair = [entry.id, coId].sort().join("|||");
          coOccurrenceCounts.set(pair, (coOccurrenceCounts.get(pair) ?? 0) + 1);
        }
      }
    }

    const sorted = [...coOccurrenceCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    const topCoOccurrences = sorted.map(([key, count]) => {
      const [a, b] = key.split("|||");
      return { pair: [a, b] as [string, string], count };
    });

    const indexStats = this.discourseIndex.getStats();

    return {
      totalEntries: this.entries.size,
      byCategory,
      byPosition,
      topCoOccurrences,
      indexStats,
      kwicRecords: this.kwicIndex.getTotalRecords(),
      variationTrees: this.variationTrees?.length ?? 0,
      formalityScore: 0,
      hedgingRatio: 0,
    };
  }

  // ── Persistence ──────────────────────────────────────────

  private async schedulePersist(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    return new Promise<void>(resolve => {
      this.saveTimer = setTimeout(async () => {
        await this.persistFn(this.serialize());
        resolve();
      }, 300);
    });
  }
}

// ── Helper ───────────────────────────────────────────────────

function estimateRegisterLabel(formalityScore: number): string {
  if (formalityScore < -0.5) return 'カジュアル';
  if (formalityScore < 0) return '普通体';
  if (formalityScore < 0.3) return '丁寧体';
  if (formalityScore < 0.7) return 'フォーマル';
  return '敬語';
}
