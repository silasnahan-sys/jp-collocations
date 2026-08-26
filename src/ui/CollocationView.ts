import { ItemView, WorkspaceLeaf, Menu, Notice } from "obsidian";
import type { App } from "obsidian";
import type { CollocationEntry, PluginSettings, SearchResult } from "../types.ts";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { SearchEngine } from "../search/SearchEngine.ts";
import type { DictionaryStore } from "../dictionary/DictionaryStore.ts";
import { AddEntryModal } from "./AddEntryModal.ts";
import { CardPreviewModal } from "./CardPreviewModal.ts";
import { detectPatterns, CATEGORY_LABELS, CATEGORY_COLORS, analyzeUtterance } from "../discourse/discourse-grammar";
import { ALL_PATTERNS, PATTERN_COUNT, PATTERN_BY_ID, type PatternCategory, type DiscoursePatternDef } from "../discourse/discourse-patterns";
import { buildVariationTrees, getRegisterProgression } from "../discourse/variation-trees";
import { type SentenceRelation, RELATION_COLORS } from "../discourse/sentence-relations";
import { heuristicResolver, type RelationsResolver } from "../discourse/relations-resolver";
import type { ContextEngine, ContextCard, PatternContextCard, UnifiedExample, VaultOccurrence } from "../context/ContextEngine";
import { LexiconPanel, type LexiconDeps } from "./LexiconPanel";
import { armSelectionEcho, mountSurfaceBar, type ViewChrome } from "./view-chrome";

// Module-level resolver, injected from main.ts at onload. Defaults to
// heuristic-only so tests / direct view construction still work.
let collocationViewResolver: RelationsResolver = heuristicResolver;
export function setCollocationViewResolver(r: RelationsResolver): void {
  collocationViewResolver = r;
}
import type { PatternMatch } from "../discourse/discourse-grammar";

export const JP_COLLOCATIONS_VIEW_TYPE = "jp-collocations-view";

type ViewTab = 'lexicon' | 'discourse' | 'patterns' | 'vault';

export class CollocationView extends ItemView {
  private store: CollocationStore;
  private engine: SearchEngine;
  private settings: PluginSettings;
  private contextEngine: ContextEngine;
  private dictStore: DictionaryStore;
  private results: SearchResult[] = [];
  private currentPOSFilter: PartOfSpeech[] = [];
  private currentTagFilter: string[] = [];
  private searchInput: HTMLInputElement | null = null;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private resultContainer: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private tabBar: HTMLElement | null = null;
  private filterRow: HTMLElement | null = null;
  private activeTab: ViewTab = 'lexicon';
  /** Currently expanded context card query (for focus mode) */
  private focusedQuery: string | null = null;
  /** The monokakido unified lexicon panel (owns the 辞書 tab when injected). */
  private lexiconPanel: LexiconPanel | null = null;
  private searchRow: HTMLElement | null = null;
  /** §26.3 — the identity bar's wiring, assigned by main.ts after construction
   *  (this constructor is already seven positional params deep). */
  chrome: ViewChrome = {};

  constructor(
    leaf: WorkspaceLeaf,
    store: CollocationStore,
    engine: SearchEngine,
    settings: PluginSettings,
    contextEngine: ContextEngine,
    dictStore: DictionaryStore,
    lexDeps?: LexiconDeps,
  ) {
    super(leaf);
    this.store = store;
    this.engine = engine;
    this.settings = settings;
    this.contextEngine = contextEngine;
    this.dictStore = dictStore;
    if (lexDeps) this.lexiconPanel = new LexiconPanel(this.app, lexDeps);
  }

  /**
   * §28 S4 — open the 語彙 tab directly on one catalog pattern. Called when a
   * class badge is tapped on another surface (X card, tray, dictionary), so
   * that mark is a door back into the lexicon rather than decoration.
   */
  openPattern(id: string): void {
    this.activeTab = 'lexicon';
    this.focusedQuery = null;
    this.tabBar?.querySelectorAll('.jp-col-tab').forEach((el) => {
      el.removeClass('jp-col-tab--active');
      if ((el as HTMLElement).dataset.tab === 'lexicon') el.addClass('jp-col-tab--active');
    });
    this.refresh();
    this.lexiconPanel?.openAt(id);
  }

  getViewType(): string { return JP_COLLOCATIONS_VIEW_TYPE; }
  getDisplayText(): string { return "JP Collocations"; }
  getIcon(): string { return "languages"; }

  async onOpen(): Promise<void> {
    this.buildUI();
    this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.lexiconPanel?.dispose();
  }

  // ══════════════════════════════════════════════════════════
  // UI SCAFFOLD
  // ══════════════════════════════════════════════════════════

  private buildUI(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-collocations-view");

    // §26.3 — the identity bar goes under the reaching hand, and WHICH dock
    // that is now belongs to `mountSurfaceBar` rather than to each view. It
    // takes the view root and resolves both. LexiconPanel docks its own search
    // row separately (it owns one and this view does not) and the two still
    // stack correctly: nav lowest, the box you are typing in directly above it.

    // Invariant 13 — 語彙 was the other surface (with 𝕏) that never armed the
    // selection layer, so selecting a word inside an entry body here produced
    // nothing at all. Same one-line arming as トレイ; the chrome's onDrop/
    // dropCan arrive from withChrome (main.ts).
    armSelectionEcho(container, this.chrome, 'lexicon');

    // Header
    const header = container.createDiv("jp-col-header");
    mountSurfaceBar(container, this.chrome, 'lexicon', header);
    header.createEl("h4", { text: "JP コロケーション", cls: "jp-col-title" });

    // Tab bar
    this.tabBar = container.createDiv("jp-col-tab-bar");
    const tabs: Array<{ id: ViewTab; label: string; icon: string }> = [
      { id: 'lexicon', label: '語彙', icon: '📖' },
      { id: 'discourse', label: '談話', icon: '🔍' },
      { id: 'patterns', label: 'パターン', icon: '📊' },
      { id: 'vault', label: 'ボルト', icon: '🗂' },
    ];
    for (const tab of tabs) {
      const btn = this.tabBar.createEl("button", {
        text: `${tab.icon} ${tab.label}`,
        cls: `jp-col-tab ${tab.id === this.activeTab ? 'jp-col-tab--active' : ''}`,
      });
      btn.dataset.tab = tab.id;
      btn.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.focusedQuery = null;
        this.tabBar!.querySelectorAll(".jp-col-tab").forEach(el => el.removeClass("jp-col-tab--active"));
        btn.addClass("jp-col-tab--active");
        this.refresh();
      });
    }

    // §28 S4: route straight to one catalog entry (a class badge on any other
    // surface is a door back, not an ornament).
    // Search bar
    const searchRow = container.createDiv("jp-col-search-row");
    this.searchRow = searchRow;
    this.searchInput = searchRow.createEl("input", {
      type: "search",
      placeholder: "検索… (JP・EN・romaji)",
      cls: "jp-col-search-input",
      attr: { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' },
    });
    // Debounced like every other live search in the plugin (辞書 80ms, 𝕏
    // 110ms, 語彙パネル 90ms): refresh() re-renders the whole active tab, and
    // running that on EVERY keystroke was the one undebounced search left.
    this.searchInput.addEventListener("input", () => {
      if (this.searchDebounce) clearTimeout(this.searchDebounce);
      this.searchDebounce = setTimeout(() => this.refresh(), 90);
    });
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const q = this.searchInput?.value.trim();
        if (q) this.openContextCard(q);
      }
    });

    const addBtn = searchRow.createEl("button", { text: "+", cls: "jp-col-add-btn", title: "Add entry" });
    addBtn.addEventListener("click", () => {
      new AddEntryModal(this.app, this.store, () => this.refresh()).open();
    });

    // POS filter chips
    this.filterRow = container.createDiv("jp-col-filter-row");
    this.buildPOSChips(this.filterRow);

    // Stats bar
    this.statsEl = container.createDiv("jp-col-stats");

    // Results
    this.resultContainer = container.createDiv("jp-col-results");
  }

  private buildPOSChips(parent: HTMLElement): void {
    const posValues = Object.values(PartOfSpeech);
    for (const pos of posValues) {
      const chip = parent.createEl("span", { text: pos, cls: "jp-col-chip" });
      chip.addEventListener("click", () => {
        if (this.currentPOSFilter.includes(pos)) {
          this.currentPOSFilter = this.currentPOSFilter.filter(p => p !== pos);
          chip.removeClass("jp-col-chip--active");
        } else {
          this.currentPOSFilter.push(pos);
          chip.addClass("jp-col-chip--active");
        }
        this.refresh();
      });
    }
    const clearBtn = parent.createEl("span", { text: "✕", cls: "jp-col-chip jp-col-chip--clear" });
    clearBtn.addEventListener("click", () => {
      this.currentPOSFilter = [];
      this.currentTagFilter = [];
      parent.querySelectorAll(".jp-col-chip--active").forEach(el => el.removeClass("jp-col-chip--active"));
      this.refresh();
    });
  }

  refresh(): void {
    if (!this.resultContainer) return;
    // The monokakido panel owns its own search + facets, so hide the legacy
    // chrome (shared search box, POS chips, stats) while it's mounted.
    const panelActive = this.activeTab === 'lexicon' && !!this.lexiconPanel;
    if (this.filterRow) this.filterRow.style.display = (this.activeTab === 'lexicon' && !panelActive) ? '' : 'none';
    if (this.searchRow) this.searchRow.style.display = panelActive ? 'none' : '';
    if (this.statsEl) this.statsEl.style.display = panelActive ? 'none' : '';

    switch (this.activeTab) {
      case 'lexicon': this.refreshLexicon(); break;
      case 'discourse': this.refreshDiscourse(); break;
      case 'patterns': this.refreshPatterns(); break;
      case 'vault': this.refreshVaultIndex(); break;
    }
  }

  // ══════════════════════════════════════════════════════════
  // CONTEXT CARD — the hivemind unified view for any query
  // ══════════════════════════════════════════════════════════

  async openContextCard(query: string): Promise<void> {
    if (!this.resultContainer || !this.statsEl) return;
    this.focusedQuery = query;
    this.resultContainer.empty();
    this.statsEl.empty();

    // Loading indicator
    const loading = this.resultContainer.createDiv('jp-col-loading');
    loading.createSpan({ text: '🔍 Searching vault…' });

    const card = await this.contextEngine.getContext(query);

    this.resultContainer.empty();
    this.statsEl.empty();

    // Back button
    const backBtn = this.statsEl.createEl('button', { text: '← 戻る', cls: 'jp-col-back-btn' });
    backBtn.addEventListener('click', () => {
      this.focusedQuery = null;
      this.refresh();
    });
    this.statsEl.createSpan({
      text: `「${query}」 — ${card.totalExamples} examples · ${card.vaultNoteCount} notes · ${card.patternCount} co-patterns`,
      cls: 'jp-col-stat-text',
    });

    this.renderContextCard(this.resultContainer, card);
  }

  private renderContextCard(parent: HTMLElement, card: ContextCard): void {
    // ── Dictionary results ───────────────────────────────
    if (card.dictResults.length > 0) {
      const sec = parent.createDiv('jp-ctx-section');
      sec.createEl('h5', { text: '📖 辞書', cls: 'jp-ctx-section-title' });
      for (const r of card.dictResults.slice(0, 3)) {
        const row = sec.createDiv('jp-ctx-dict-row');
        row.createSpan({ text: r.term.expression, cls: 'jp-ctx-dict-expr' });
        if (r.term.reading !== r.term.expression) {
          row.createSpan({ text: `【${r.term.reading}】`, cls: 'jp-ctx-dict-reading' });
        }
        // Show first definition as text
        const defText = r.term.definitions.slice(0, 2).map(d => {
          if (typeof d === 'string') return d;
          if ('type' in d && (d as any).type === 'text' && 'text' in d) return (d as any).text;
          return '';
        }).filter(Boolean).join(' / ');
        if (defText) row.createSpan({ text: defText, cls: 'jp-ctx-dict-def' });

        // Tap to open full dictionary
        row.addEventListener('click', () => {
          // Open dictionary view for this word
          (this.app as any).commands.executeCommandById('jp-collocations:open-dictionary');
        });
      }
    }

    // ── Collocations ─────────────────────────────────────
    if (card.collocations.length > 0) {
      const sec = parent.createDiv('jp-ctx-section');
      sec.createEl('h5', { text: '📚 コロケーション', cls: 'jp-ctx-section-title' });
      for (const e of card.collocations) {
        const row = sec.createDiv('jp-ctx-collocation-row');
        row.createSpan({ text: e.fullPhrase, cls: 'jp-ctx-coll-phrase' });
        row.createSpan({ text: e.headwordPOS, cls: 'jp-ctx-coll-pos' });
        if (e.pattern) row.createSpan({ text: e.pattern, cls: 'jp-ctx-coll-pattern' });
      }
    }

    // ── Surfer entries ───────────────────────────────────
    if (card.surferEntries.length > 0) {
      const sec = parent.createDiv('jp-ctx-section');
      sec.createEl('h5', { text: '🏄 サーファーエントリー', cls: 'jp-ctx-section-title' });
      for (const e of card.surferEntries) {
        const row = sec.createDiv('jp-ctx-surfer-row');
        row.createSpan({ text: e.surface, cls: 'jp-ctx-surfer-surface' });
        if (e.discourseCategory) {
          row.createSpan({ text: e.discourseCategory, cls: 'jp-ctx-surfer-cat' });
        }
        if (e.pragmaticFunction) {
          row.createSpan({ text: e.pragmaticFunction, cls: 'jp-ctx-surfer-fn' });
        }
      }
    }

    // ── Examples with discourse styling ──────────────────
    if (card.examples.length > 0) {
      const sec = parent.createDiv('jp-ctx-section jp-ctx-examples-section');
      sec.createEl('h5', { text: `💬 用例 (${card.examples.length})`, cls: 'jp-ctx-section-title' });
      for (const ex of card.examples.slice(0, 30)) {
        this.renderStyledExample(sec, ex, card.query);
      }
    }

    // ── Vault occurrences ────────────────────────────────
    if (card.vaultOccurrences.length > 0) {
      const sec = parent.createDiv('jp-ctx-section');
      sec.createEl('h5', { text: `🗂 ノート (${card.vaultNoteCount})`, cls: 'jp-ctx-section-title' });
      // Group by file
      const byFile = new Map<string, VaultOccurrence[]>();
      for (const occ of card.vaultOccurrences) {
        if (!byFile.has(occ.filePath)) byFile.set(occ.filePath, []);
        byFile.get(occ.filePath)!.push(occ);
      }
      for (const [fp, occs] of byFile) {
        const fileGroup = sec.createDiv('jp-ctx-vault-file');
        const fileHeader = fileGroup.createDiv('jp-ctx-vault-file-header');
        fileHeader.createSpan({ text: `📄 ${occs[0].fileName}`, cls: 'jp-ctx-vault-filename' });
        fileHeader.createSpan({ text: `(${occs.length})`, cls: 'jp-ctx-vault-count' });
        fileHeader.addEventListener('click', () => {
          const file = this.app.vault.getAbstractFileByPath(fp);
          if (file) this.app.workspace.getLeaf().openFile(file as any);
        });

        for (const occ of occs.slice(0, 5)) {
          const occRow = fileGroup.createDiv('jp-ctx-vault-occ');
          // Render context with the query highlighted
          this.renderHighlightedContext(occRow, occ.context, card.query);
          // Show nearby patterns as tiny pills
          if (occ.nearbyPatterns.length > 0) {
            const pills = occRow.createDiv('jp-ctx-vault-patterns');
            for (const pid of occ.nearbyPatterns.slice(0, 5)) {
              const p = PATTERN_BY_ID.get(pid);
              if (p) {
                const pill = pills.createSpan({
                  text: p.surface,
                  cls: 'jp-ctx-pattern-pill',
                });
                pill.style.borderLeft = `2px solid ${CATEGORY_COLORS[p.category] ?? '#95a5a6'}`;
                pill.addEventListener('click', (e) => {
                  e.stopPropagation();
                  this.openPatternCard(pid);
                });
              }
            }
          }
        }
      }
    }

    // ── Typed bit-relations (sidecar) ── authoritative typed pairs.
    if (card.bitRelations.length > 0) {
      const sec = parent.createDiv('jp-ctx-section');
      sec.createEl('h5', {
        text: `✓ 型付き関係 (${card.bitRelations.length}) サイドカー`,
        cls: 'jp-ctx-section-title',
      });
      const list = sec.createDiv('jp-ctx-bitrel-list');
      for (const br of card.bitRelations.slice(0, 12)) {
        const row = list.createDiv('jp-ctx-bitrel-row');
        row.dataset.reconciliation = br.reconciliation ?? 'unknown';
        const labelEl = row.createSpan({
          text: br.label.replace(/_/g, ' '),
          cls: 'jp-ctx-bitrel-label',
        });
        labelEl.title =
          `reconciliation: ${br.reconciliation ?? 'n/a'} · ` +
          `confidence: ${(br.confidence ?? 0).toFixed(2)} · ` +
          `hash: ${br.textHash.slice(0, 8)}…`;
        const pair = row.createDiv('jp-ctx-bitrel-pair');
        const srcCls = br.matchedRole === 'source'
          ? 'jp-ctx-bitrel-endpoint jp-ctx-bitrel-endpoint--matched'
          : 'jp-ctx-bitrel-endpoint';
        const tgtCls = br.matchedRole === 'target'
          ? 'jp-ctx-bitrel-endpoint jp-ctx-bitrel-endpoint--matched'
          : 'jp-ctx-bitrel-endpoint';
        pair.createSpan({ text: br.sourceSurface, cls: srcCls });
        pair.createSpan({ text: '→', cls: 'jp-ctx-bitrel-arrow' });
        pair.createSpan({ text: br.targetSurface, cls: tgtCls });
      }
    }

    // ── Co-occurring patterns ────────────────────────────
    if (card.coPatterns.length > 0) {
      const sec = parent.createDiv('jp-ctx-section');
      sec.createEl('h5', { text: '🔗 共起パターン', cls: 'jp-ctx-section-title' });
      const grid = sec.createDiv('jp-ctx-copattern-grid');
      for (const cp of card.coPatterns) {
        const chip = grid.createDiv('jp-ctx-copattern-chip');
        chip.createSpan({ text: cp.surface, cls: 'jp-ctx-copattern-surface' });
        chip.createSpan({ text: `×${cp.count}`, cls: 'jp-ctx-copattern-count' });
        const color = CATEGORY_COLORS[cp.category as PatternCategory] ?? '#95a5a6';
        chip.style.borderLeft = `3px solid ${color}`;
        chip.addEventListener('click', () => this.openPatternCard(cp.patternId));
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // PATTERN CONTEXT CARD
  // ══════════════════════════════════════════════════════════

  private async openPatternCard(patternId: string): Promise<void> {
    if (!this.resultContainer || !this.statsEl) return;
    this.resultContainer.empty();
    this.statsEl.empty();

    const loading = this.resultContainer.createDiv('jp-col-loading');
    loading.createSpan({ text: '🔍 パターン文脈を検索中…' });

    const card = await this.contextEngine.getPatternContext(patternId);
    this.resultContainer.empty();
    this.statsEl.empty();

    if (!card) {
      this.resultContainer.createDiv({ text: 'Pattern not found', cls: 'jp-col-empty' });
      return;
    }

    // Back button
    const backRow = this.statsEl.createDiv('jp-ctx-back-row');
    const backBtn = backRow.createEl('button', { text: '← 戻る', cls: 'jp-col-back-btn' });
    backBtn.addEventListener('click', () => {
      this.focusedQuery = null;
      this.refresh();
    });

    // Pattern header
    const header = this.resultContainer.createDiv('jp-ctx-pattern-header');
    const badge = header.createSpan({ text: card.category, cls: 'jp-ctx-pattern-badge' });
    badge.style.backgroundColor = card.categoryColor;
    header.createEl('h4', { text: card.surface, cls: 'jp-ctx-pattern-title' });
    const metaRow = header.createDiv('jp-ctx-pattern-meta');
    metaRow.createSpan({ text: card.gloss, cls: 'jp-ctx-pattern-gloss' });
    metaRow.createSpan({ text: card.glossEn, cls: 'jp-ctx-pattern-gloss-en' });
    metaRow.createSpan({ text: `[${card.register}]`, cls: 'jp-ctx-pattern-register' });
    metaRow.createSpan({ text: `Tier ${card.frequencyTier}`, cls: 'jp-ctx-pattern-freq' });
    metaRow.createSpan({ text: card.categoryLabel, cls: 'jp-ctx-pattern-cat-label' });

    // ── KWIC lines ───────────────────────────────────────
    if (card.kwicLines.length > 0) {
      const sec = this.resultContainer.createDiv('jp-ctx-section');
      sec.createEl('h5', { text: `📝 KWIC (${card.kwicLines.length})`, cls: 'jp-ctx-section-title' });
      for (const kw of card.kwicLines.slice(0, 20)) {
        const row = sec.createDiv('jp-ctx-kwic-row');
        row.createSpan({ text: kw.left, cls: 'jp-ctx-kwic-left' });
        row.createSpan({ text: kw.match, cls: 'jp-ctx-kwic-match' });
        row.createSpan({ text: kw.right, cls: 'jp-ctx-kwic-right' });
        const fileLink = row.createSpan({ text: kw.file.replace(/.*\//, ''), cls: 'jp-ctx-kwic-file' });
        fileLink.addEventListener('click', () => {
          const f = this.app.vault.getAbstractFileByPath(kw.file);
          if (f) this.app.workspace.getLeaf().openFile(f as any);
        });
      }
    }

    // ── Vault occurrences ────────────────────────────────
    if (card.vaultOccurrences.length > 0) {
      const sec = this.resultContainer.createDiv('jp-ctx-section');
      sec.createEl('h5', { text: `🗂 ボルト出現 (${card.vaultOccurrences.length})`, cls: 'jp-ctx-section-title' });
      for (const occ of card.vaultOccurrences.slice(0, 15)) {
        const row = sec.createDiv('jp-ctx-vault-occ');
        const fileLink = row.createSpan({ text: `📄 ${occ.fileName}`, cls: 'jp-ctx-vault-filename' });
        fileLink.addEventListener('click', () => {
          const f = this.app.vault.getAbstractFileByPath(occ.filePath);
          if (f) this.app.workspace.getLeaf().openFile(f as any);
        });
        this.renderHighlightedContext(row, occ.context, card.surface);
      }
    }

    // ── Examples from all sources ────────────────────────
    if (card.examples.length > 0) {
      const sec = this.resultContainer.createDiv('jp-ctx-section jp-ctx-examples-section');
      sec.createEl('h5', { text: `💬 用例 (${card.examples.length})`, cls: 'jp-ctx-section-title' });
      for (const ex of card.examples.slice(0, 20)) {
        this.renderStyledExample(sec, ex, card.surface);
      }
    }

    // ── Co-occurring patterns ────────────────────────────
    if (card.coPatterns.length > 0) {
      const sec = this.resultContainer.createDiv('jp-ctx-section');
      sec.createEl('h5', { text: '🔗 共起パターン', cls: 'jp-ctx-section-title' });
      const grid = sec.createDiv('jp-ctx-copattern-grid');
      for (const cp of card.coPatterns) {
        const chip = grid.createDiv('jp-ctx-copattern-chip');
        chip.createSpan({ text: cp.surface, cls: 'jp-ctx-copattern-surface' });
        chip.createSpan({ text: `×${cp.count}`, cls: 'jp-ctx-copattern-count' });
        chip.addEventListener('click', () => this.openPatternCard(cp.patternId));
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // STYLED EXAMPLE RENDERING — discourse patterns inline
  // ══════════════════════════════════════════════════════════

  /**
   * Render an example sentence with inline discourse pattern highlighting,
   * relation markers, source badge, and clickable Japanese text.
   */
  private renderStyledExample(parent: HTMLElement, ex: UnifiedExample, highlightTerm: string): void {
    const row = parent.createDiv('jp-ctx-example');

    // Source badge
    const sourceBadge = row.createSpan({ cls: 'jp-ctx-example-source' });
    const sourceIcons: Record<string, string> = {
      vault: '📄', dictionary: '📖', collocation: '📚', surfer: '🏄', manual: '✏️',
    };
    sourceBadge.textContent = sourceIcons[ex.source] ?? '?';
    sourceBadge.title = `${ex.source}: ${ex.sourceDetail}`;

    // Text with inline pattern highlights
    const textEl = row.createDiv('jp-ctx-example-text');
    this.renderAnnotatedText(textEl, ex.text, ex.patterns, highlightTerm);

    // Relation indicators
    if (ex.relations.length > 0) {
      const relRow = row.createDiv('jp-ctx-example-relations');
      for (const rel of ex.relations.slice(0, 3)) {
        const relChip = relRow.createSpan({ cls: 'jp-ctx-rel-chip' });
        const colorCls = RELATION_COLORS[rel.type] ?? 'jp-rel-cause';
        relChip.addClass(colorCls);
        relChip.textContent = `${rel.type.replace(/-/g, ' ')}`;
        relChip.title = `${rel.source.text} → ${rel.target.text}`;
      }
    }

    // Tap source detail to navigate
    if (ex.source === 'vault') {
      row.addEventListener('click', () => {
        const f = this.app.vault.getAbstractFileByPath(ex.sourceDetail);
        if (f) this.app.workspace.getLeaf().openFile(f as any);
      });
      row.addClass('jp-ctx-example--clickable');
    }
  }

  /**
   * Render text with discourse patterns highlighted inline.
   * Patterns get colored underlines; the search term gets a highlight.
   */
  private renderAnnotatedText(
    parent: HTMLElement,
    text: string,
    patterns: PatternMatch[],
    highlightTerm: string,
  ): void {
    // Build a list of ranges to style
    interface StyledRange {
      start: number; end: number;
      cls: string;
      title?: string;
      patternId?: string;
    }

    const ranges: StyledRange[] = [];

    // Pattern ranges
    for (const m of patterns) {
      ranges.push({
        start: m.offset,
        end: m.offset + m.matchedText.length,
        cls: `jp-ctx-inline-pattern jp-vis-cat-${m.pattern.category}`,
        title: `${m.pattern.category}: ${m.pattern.gloss} — ${m.pattern.glossEn}`,
        patternId: m.pattern.id,
      });
    }

    // Highlight term ranges
    if (highlightTerm) {
      let idx = 0;
      while (true) {
        const pos = text.indexOf(highlightTerm, idx);
        if (pos === -1) break;
        ranges.push({
          start: pos,
          end: pos + highlightTerm.length,
          cls: 'jp-ctx-highlight-term',
        });
        idx = pos + 1;
      }
    }

    // Sort by start position; for overlaps, shorter ranges go first
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);

    // Render with non-overlapping spans
    let cursor = 0;
    for (const r of ranges) {
      if (r.start < cursor) continue; // skip overlapping
      // Plain text before this range
      if (r.start > cursor) {
        parent.appendText(text.slice(cursor, r.start));
      }
      const span = parent.createSpan({
        text: text.slice(r.start, r.end),
        cls: r.cls,
      });
      if (r.title) span.title = r.title;
      if (r.patternId) {
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openPatternCard(r.patternId!);
        });
      }
      cursor = r.end;
    }
    // Remaining text
    if (cursor < text.length) {
      parent.appendText(text.slice(cursor));
    }
  }

  /** Render a context snippet with the query term highlighted */
  private renderHighlightedContext(parent: HTMLElement, context: string, term: string): void {
    const ctxEl = parent.createDiv('jp-ctx-highlighted-text');
    const lower = context.toLowerCase();
    const tLower = term.toLowerCase();
    let cursor = 0;
    let idx = lower.indexOf(tLower, cursor);
    while (idx !== -1) {
      if (idx > cursor) ctxEl.appendText(context.slice(cursor, idx));
      ctxEl.createSpan({ text: context.slice(idx, idx + term.length), cls: 'jp-ctx-highlight-term' });
      cursor = idx + term.length;
      idx = lower.indexOf(tLower, cursor);
    }
    if (cursor < context.length) ctxEl.appendText(context.slice(cursor));
  }

  // ══════════════════════════════════════════════════════════
  // TAB: LEXICON
  // ══════════════════════════════════════════════════════════

  private refreshLexicon(): void {
    // The monokakido unified panel (catalog + lexicon + dict, context tree).
    if (this.lexiconPanel && this.resultContainer) {
      this.lexiconPanel.render(this.resultContainer);
      return;
    }

    const query = this.searchInput?.value ?? "";

    // If we have a focused query, show context card instead
    if (this.focusedQuery) {
      this.openContextCard(this.focusedQuery);
      return;
    }

    this.results = this.engine.search({
      query,
      posFilter: this.currentPOSFilter.length ? this.currentPOSFilter : undefined,
      tagFilter: this.currentTagFilter.length ? this.currentTagFilter : undefined,
      fuzzy: true,
      maxResults: this.settings.maxResults,
      sortBy: this.settings.defaultSortOrder,
    });

    this.renderStats();
    this.renderResults();
  }

  private renderStats(): void {
    if (!this.statsEl) return;
    const stats = this.store.getStats();
    this.statsEl.empty();

    // Quick stats
    const indexStats = this.contextEngine.getIndexStats();
    this.statsEl.createSpan({
      text: `${this.results.length}/${stats.total} entries · ${indexStats?.indexStats?.filesIndexed ?? 0} files indexed`,
      cls: "jp-col-stat-text",
    });
  }

  private renderResults(): void {
    if (!this.resultContainer) return;
    this.resultContainer.empty();

    if (this.results.length === 0) {
      const emptyDiv = this.resultContainer.createDiv({ cls: "jp-col-empty" });
      emptyDiv.createSpan({ text: "結果なし" });
      // Suggestion: search with context engine
      const q = this.searchInput?.value?.trim();
      if (q) {
        const ctxBtn = emptyDiv.createEl('button', {
          text: `🔍 「${q}」をボルト全体で検索`,
          cls: 'jp-col-action-btn',
        });
        ctxBtn.addEventListener('click', () => this.openContextCard(q));
      }
      return;
    }

    for (const result of this.results) {
      this.renderEntry(this.resultContainer, result.entry);
    }
  }

  private renderEntry(parent: HTMLElement, entry: CollocationEntry): void {
    const card = parent.createDiv("jp-col-card");

    // ── Header row ───────────────────────────────────────
    const mainRow = card.createDiv("jp-col-card-main");
    const hwSpan = mainRow.createSpan({ cls: "jp-col-headword", text: entry.headword });
    // Tap headword → open full context card
    hwSpan.addEventListener('click', () => this.openContextCard(entry.headword));

    if (this.settings.showReadings && entry.headwordReading) {
      mainRow.createSpan({ cls: "jp-col-reading", text: `（${entry.headwordReading}）` });
    }
    mainRow.createSpan({ cls: "jp-col-collocate", text: " " + entry.collocate });
    mainRow.createSpan({
      cls: `jp-col-pos jp-col-pos--${this.posClass(entry.headwordPOS)}`,
      text: entry.headwordPOS,
    });
    if (entry.pattern) {
      mainRow.createSpan({ cls: "jp-col-pattern-label", text: entry.pattern });
    }

    // ── Actions row ──────────────────────────────────────
    const actRow = card.createDiv("jp-col-actions");
    this.buildActions(actRow, entry);

    // ── Expandable: examples with discourse styling ──────
    if (entry.exampleSentences.length > 0 || entry.notes) {
      const details = card.createEl("details", { cls: "jp-col-details" });
      const summary = details.createEl("summary", { cls: "jp-col-details-summary" });
      summary.createSpan({ text: `💬 ${entry.exampleSentences.length} examples` });

      for (const s of entry.exampleSentences) {
        const exDiv = details.createDiv('jp-col-example-styled');
        const patterns = detectPatterns(s);
        this.renderAnnotatedText(exDiv, s, patterns, entry.headword);
      }
      if (entry.notes) {
        details.createEl("p", { text: entry.notes, cls: "jp-col-notes" });
      }
    }
  }

  private buildActions(parent: HTMLElement, entry: CollocationEntry): void {
    const btns: Array<{ text: string; title: string; cls?: string; fn: () => void }> = [
      { text: '📋', title: 'Copy', fn: () => {
        navigator.clipboard.writeText(entry.fullPhrase).then(() => new Notice(`Copied: ${entry.fullPhrase}`));
      }},
      { text: '📥', title: 'Insert', fn: () => {
        const editor = this.app.workspace.activeEditor?.editor;
        if (editor) { editor.replaceSelection(entry.fullPhrase); new Notice(`Inserted`); }
      }},
      { text: '✏️', title: 'Edit', fn: () => {
        new AddEntryModal(this.app, this.store, () => this.refresh(), entry).open();
      }},
      { text: '🔍', title: 'Context', fn: () => this.openContextCard(entry.headword) },
      { text: '🎴', title: 'SRS', fn: () => {
        new CardPreviewModal(this.app, '', [entry], undefined, this.settings.srs ?? {}).open();
      }},
      { text: '×', title: 'Delete', cls: 'jp-col-action-btn--danger', fn: () => {
        this.store.delete(entry.id); new Notice(`Deleted`); this.refresh();
      }},
    ];

    for (const b of btns) {
      const btn = parent.createEl('button', {
        text: b.text,
        cls: `jp-col-action-btn ${b.cls ?? ''}`,
        attr: { title: b.title, 'aria-label': b.title },
      });
      btn.addEventListener('click', b.fn);
    }
  }

  // ══════════════════════════════════════════════════════════
  // TAB: DISCOURSE ANALYSIS
  // ══════════════════════════════════════════════════════════

  private refreshDiscourse(): void {
    if (!this.resultContainer || !this.statsEl) return;
    this.resultContainer.empty();
    this.statsEl.empty();

    const query = this.searchInput?.value ?? "";

    if (!query.trim()) {
      this.statsEl.createSpan({ text: '談話文法分析 — テキストを入力して分析', cls: "jp-col-stat-text" });
      this.resultContainer.createDiv({
        text: "日本語テキストを入力すると、談話パターン・論理展開フロー・レジスターを検出します。",
        cls: "jp-col-empty",
      });
      return;
    }

    const analysis = analyzeUtterance(query);
    const resolved = collocationViewResolver(query, { filePath: this.app.workspace.getActiveFile()?.path });
    const { relations } = resolved;
    const sourceTag = resolved.source === 'sidecar' ? '[sidecar]' : '[heuristic]';

    this.statsEl.createSpan({
      text: `${analysis.patterns.length} markers · ${relations.length} relations ${sourceTag} · ${analysis.estimatedRegister}`,
      cls: "jp-col-stat-text",
    });

    // ── Annotated text ───────────────────────────────────
    const textSection = this.resultContainer.createDiv('jp-col-discourse-annotated');
    textSection.createEl('h5', { text: '注釈付きテキスト', cls: 'jp-col-section-title' });
    const textBody = textSection.createDiv('jp-ctx-annotated-body');
    this.renderAnnotatedText(textBody, query, analysis.patterns, '');

    // ── Relation map ─────────────────────────────────────
    if (relations.length > 0) {
      const relSection = this.resultContainer.createDiv('jp-col-discourse-section');
      relSection.createEl('h5', { text: `🔗 文間関係 (${relations.length})`, cls: 'jp-col-section-title' });
      for (const rel of relations) {
        const row = relSection.createDiv('jp-ctx-relation-row');
        const colorCls = RELATION_COLORS[rel.type] ?? 'jp-rel-cause';
        row.addClass(colorCls);

        row.createSpan({ text: rel.source.text.slice(0, 30), cls: 'jp-ctx-rel-source' });
        row.createSpan({ text: ` →[${rel.type}]→ `, cls: 'jp-ctx-rel-arrow' });
        row.createSpan({ text: rel.target.text.slice(0, 30), cls: 'jp-ctx-rel-target' });
        row.createSpan({
          text: ` (${(rel.confidence * 100).toFixed(0)}%)`,
          cls: 'jp-ctx-rel-confidence',
        });
      }
    }

    // ── Category breakdown ───────────────────────────────
    const catRow = this.resultContainer.createDiv("jp-col-discourse-cats");
    for (const [cat, count] of Object.entries(analysis.categoryBreakdown)) {
      const label = CATEGORY_LABELS[cat as PatternCategory] ?? cat;
      const color = CATEGORY_COLORS[cat as PatternCategory] ?? '#95a5a6';
      const chip = catRow.createEl("span", {
        text: `${cat}: ${label} (${count})`,
        cls: "jp-col-discourse-chip",
      });
      chip.style.borderLeft = `3px solid ${color}`;
    }

    // ── Detected patterns (clickable) ────────────────────
    if (analysis.patterns.length > 0) {
      const patSection = this.resultContainer.createDiv("jp-col-discourse-section");
      patSection.createEl("h5", { text: "検出パターン", cls: "jp-col-section-title" });
      for (const m of analysis.patterns) {
        const row = patSection.createDiv("jp-col-discourse-match");
        const color = CATEGORY_COLORS[m.pattern.category] ?? '#95a5a6';
        const badge = row.createSpan({ text: m.pattern.category, cls: "jp-col-discourse-badge" });
        badge.style.backgroundColor = color;
        const surfSpan = row.createSpan({ text: m.pattern.surface, cls: "jp-col-discourse-surface" });
        surfSpan.addEventListener('click', () => this.openPatternCard(m.pattern.id));
        row.createSpan({ text: m.pattern.gloss, cls: "jp-col-discourse-gloss" });
        row.createSpan({ text: m.pattern.glossEn, cls: "jp-col-discourse-gloss-en" });
        row.createSpan({ text: `[${m.pattern.register}]`, cls: "jp-col-discourse-register" });
      }
    }

    // ── Logical flows ────────────────────────────────────
    if (analysis.flows.length > 0) {
      const flowSection = this.resultContainer.createDiv("jp-col-discourse-section");
      flowSection.createEl("h5", { text: "論理展開フロー", cls: "jp-col-section-title" });
      for (const f of analysis.flows) {
        const row = flowSection.createDiv("jp-col-discourse-flow");
        row.createSpan({ text: `🔗 ${f.flow.name}`, cls: "jp-col-flow-name" });
        row.createSpan({ text: f.flow.descriptionEn, cls: "jp-col-flow-desc" });
      }
    }

    // ── Functions ────────────────────────────────────────
    if (analysis.dominantFunctions.length > 0) {
      const fnSection = this.resultContainer.createDiv("jp-col-discourse-section");
      fnSection.createEl("h5", { text: "主要機能", cls: "jp-col-section-title" });
      const fnRow = fnSection.createDiv("jp-col-discourse-functions");
      for (const fn of analysis.dominantFunctions) {
        fnRow.createSpan({ text: fn, cls: "jp-col-fn-chip" });
      }
    }

    // ── CSJ ──────────────────────────────────────────────
    const { csj } = analysis;
    if (csj.fillers.length > 0 || csj.spokenVariations.length > 0 || csj.speechType !== 'unknown') {
      const csjSection = this.resultContainer.createDiv("jp-col-discourse-section");
      csjSection.createEl("h5", { text: "CSJ 話し言葉分析", cls: "jp-col-section-title" });
      const summaryRow = csjSection.createDiv("jp-col-csj-summary");
      summaryRow.createSpan({
        text: `レジスター: ${csj.registerLabel} (${csj.registerScore > 0 ? '+' : ''}${csj.registerScore.toFixed(1)})`,
        cls: "jp-col-csj-register",
      });
      if (csj.speechType !== 'unknown') {
        summaryRow.createSpan({ text: `話体: ${csj.speechType}`, cls: "jp-col-csj-speech-type" });
      }
      summaryRow.createSpan({
        text: `フィラー密度: ${(csj.fillerDensity * 100).toFixed(1)}%`,
        cls: "jp-col-csj-filler-density",
      });
      if (csj.fillers.length > 0) {
        const fillerDiv = csjSection.createDiv("jp-col-csj-fillers");
        fillerDiv.createEl("h6", { text: "検出フィラー" });
        for (const f of csj.fillers) {
          const row = fillerDiv.createDiv("jp-col-csj-filler-row");
          row.createSpan({ text: f.surface, cls: "jp-col-csj-filler-surface" });
          row.createSpan({ text: `${f.perMillion}/M`, cls: "jp-col-csj-freq" });
          row.createSpan({ text: f.pragmaticFunction, cls: "jp-col-csj-function" });
        }
      }
      if (csj.spokenVariations.length > 0) {
        const varDiv = csjSection.createDiv("jp-col-csj-variations");
        varDiv.createEl("h6", { text: "話し言葉変異" });
        for (const v of csj.spokenVariations) {
          const row = varDiv.createDiv("jp-col-csj-variation-row");
          row.createSpan({ text: `${v.standard} → ${v.variant}`, cls: "jp-col-csj-variation-pair" });
          row.createSpan({ text: v.type, cls: "jp-col-csj-variation-type" });
          row.createSpan({ text: v.glossEn, cls: "jp-col-csj-gloss" });
        }
      }
    }

    // SRS button
    if (analysis.patterns.length > 0) {
      const srsBtn = this.resultContainer.createEl("button", {
        text: "🎴 Generate Script Cards",
        cls: "jp-col-action-btn jp-srs-generate-btn",
      });
      srsBtn.addEventListener("click", () => {
        new CardPreviewModal(this.app, query, [], undefined, this.settings.srs ?? {}).open();
      });
    }
  }

  // ══════════════════════════════════════════════════════════
  // TAB: PATTERN DATABASE
  // ══════════════════════════════════════════════════════════

  private refreshPatterns(): void {
    if (!this.resultContainer || !this.statsEl) return;
    this.resultContainer.empty();
    this.statsEl.empty();

    const query = this.searchInput?.value ?? "";
    this.statsEl.createSpan({
      text: `談話パターンDB: ${ALL_PATTERNS.length} patterns · 14 categories (A–N)`,
      cls: "jp-col-stat-text",
    });

    let patterns = ALL_PATTERNS;
    if (query.trim()) {
      const lower = query.toLowerCase();
      patterns = ALL_PATTERNS.filter(p =>
        p.surface.includes(lower) || p.gloss.includes(query) ||
        p.glossEn.toLowerCase().includes(lower) || p.subcategory.includes(query) ||
        p.categoryLabel.includes(query) || p.id.toLowerCase().includes(lower)
      );
    }

    // Group by category
    const grouped = new Map<PatternCategory, DiscoursePatternDef[]>();
    for (const p of patterns) {
      if (!grouped.has(p.category)) grouped.set(p.category, []);
      grouped.get(p.category)!.push(p);
    }

    for (const [cat, pats] of grouped) {
      const section = this.resultContainer.createDiv("jp-col-pattern-section");
      const color = CATEGORY_COLORS[cat] ?? '#95a5a6';
      const title = section.createEl("h5", {
        text: `${cat}: ${CATEGORY_LABELS[cat]} (${pats.length})`,
        cls: "jp-col-section-title",
      });
      title.style.borderLeft = `3px solid ${color}`;

      const list = section.createDiv("jp-col-pattern-list");
      for (const p of pats.slice(0, 30)) {
        const row = list.createDiv("jp-col-pattern-row");
        // Clickable surface → opens pattern context card
        const surfSpan = row.createSpan({ text: p.surface, cls: "jp-col-pattern-surface jp-col-pattern-surface--clickable" });
        surfSpan.style.borderBottom = `2px solid ${color}`;
        surfSpan.addEventListener('click', () => this.openPatternCard(p.id));

        row.createSpan({ text: p.gloss, cls: "jp-col-pattern-gloss" });
        row.createSpan({ text: p.glossEn, cls: "jp-col-pattern-gloss-en" });
        const meta = row.createSpan({ cls: "jp-col-pattern-meta" });
        meta.createSpan({ text: p.register, cls: "jp-col-meta-register" });
        meta.createSpan({ text: `T${p.frequencyTier}`, cls: "jp-col-meta-freq" });
      }
      if (pats.length > 30) {
        const moreBtn = list.createEl('button', {
          text: `+ ${pats.length - 30} more`,
          cls: 'jp-col-pattern-more-btn',
        });
        moreBtn.addEventListener('click', () => {
          moreBtn.remove();
          for (const p of pats.slice(30)) {
            const row = list.createDiv("jp-col-pattern-row");
            const surfSpan = row.createSpan({ text: p.surface, cls: "jp-col-pattern-surface jp-col-pattern-surface--clickable" });
            surfSpan.style.borderBottom = `2px solid ${color}`;
            surfSpan.addEventListener('click', () => this.openPatternCard(p.id));
            row.createSpan({ text: p.gloss, cls: "jp-col-pattern-gloss" });
            row.createSpan({ text: p.glossEn, cls: "jp-col-pattern-gloss-en" });
          }
        });
      }
    }

    // Variation trees
    if (!query.trim()) {
      const treeSection = this.resultContainer.createDiv("jp-col-pattern-section");
      treeSection.createEl("h5", { text: "活用ツリー (Variation Trees)", cls: "jp-col-section-title" });
      const trees = buildVariationTrees();
      for (const tree of trees.slice(0, 10)) {
        const treeDiv = treeSection.createDiv("jp-col-var-tree");
        treeDiv.createSpan({ text: `「${tree.stem}」`, cls: "jp-col-tree-stem" });
        treeDiv.createSpan({ text: tree.conceptLabel, cls: "jp-col-tree-concept" });
        const variants = getRegisterProgression(tree);
        const varList = treeDiv.createDiv("jp-col-tree-variants");
        for (const v of variants.slice(0, 5)) {
          const varSpan = varList.createSpan({ text: `${v.surface} [${v.register}]`, cls: "jp-col-tree-variant" });
        }
        if (variants.length > 5) {
          varList.createSpan({ text: `+${variants.length - 5} more`, cls: "jp-col-tree-more" });
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // TAB: VAULT INDEX — see your vault's discourse fingerprint
  // ══════════════════════════════════════════════════════════

  private refreshVaultIndex(): void {
    if (!this.resultContainer || !this.statsEl) return;
    this.resultContainer.empty();
    this.statsEl.empty();

    const stats = this.contextEngine.getIndexStats();
    const indexedFiles = this.contextEngine.getIndexedFiles();

    this.statsEl.createSpan({
      text: `${stats?.indexStats?.filesIndexed ?? 0} files · ${stats?.indexStats?.totalOccurrences ?? 0} patterns · ${stats?.indexStats?.coOccurrencePairs ?? 0} co-occurrences`,
      cls: "jp-col-stat-text",
    });

    if (indexedFiles.length === 0) {
      this.resultContainer.createDiv({
        text: "ファイルを開くと自動的にインデックスされます。ノートを開いて談話パターンの検出を始めましょう。",
        cls: "jp-col-empty",
      });
      return;
    }

    // ── Pattern density heatmap ──────────────────────────
    const heatSection = this.resultContainer.createDiv('jp-ctx-section');
    heatSection.createEl('h5', { text: 'パターン密度', cls: 'jp-ctx-section-title' });
    const catCounts: Record<string, number> = {};
    for (const fp of indexedFiles) {
      const pats = this.contextEngine.getFilePatterns(fp);
      for (const pid of pats) {
        const cat = pid.charAt(0);
        catCounts[cat] = (catCounts[cat] ?? 0) + 1;
      }
    }
    const heatGrid = heatSection.createDiv('jp-ctx-heat-grid');
    for (const cat of Object.keys(CATEGORY_LABELS).sort()) {
      const count = catCounts[cat] ?? 0;
      if (count === 0) continue;
      const bar = heatGrid.createDiv('jp-ctx-heat-bar');
      bar.createSpan({ text: `${cat}`, cls: 'jp-ctx-heat-cat' });
      const fill = bar.createDiv('jp-ctx-heat-fill');
      const maxCount = Math.max(...Object.values(catCounts));
      fill.style.width = `${Math.max(5, (count / maxCount) * 100)}%`;
      fill.style.backgroundColor = CATEGORY_COLORS[cat as PatternCategory] ?? '#95a5a6';
      bar.createSpan({ text: `${count}`, cls: 'jp-ctx-heat-count' });
      bar.createSpan({
        text: CATEGORY_LABELS[cat as PatternCategory] ?? cat,
        cls: 'jp-ctx-heat-label',
      });
    }

    // ── Indexed files list ───────────────────────────────
    const fileSection = this.resultContainer.createDiv('jp-ctx-section');
    fileSection.createEl('h5', { text: `📁 インデックス済み (${indexedFiles.length})`, cls: 'jp-ctx-section-title' });

    // Sort by pattern count (richest first)
    const filePats = indexedFiles.map(fp => ({
      path: fp,
      name: fp.replace(/.*\//, '').replace(/\.md$/, ''),
      patterns: this.contextEngine.getFilePatterns(fp),
    })).sort((a, b) => b.patterns.length - a.patterns.length);

    for (const fp of filePats.slice(0, 50)) {
      const row = fileSection.createDiv('jp-ctx-vault-file-row');
      const nameSpan = row.createSpan({ text: `📄 ${fp.name}`, cls: 'jp-ctx-vault-filename' });
      nameSpan.addEventListener('click', () => {
        const f = this.app.vault.getAbstractFileByPath(fp.path);
        if (f) this.app.workspace.getLeaf().openFile(f as any);
      });
      row.createSpan({ text: `${fp.patterns.length} patterns`, cls: 'jp-ctx-vault-patcount' });

      // Category breakdown mini-bar
      const miniBar = row.createDiv('jp-ctx-mini-bar');
      const catBreakdown: Record<string, number> = {};
      for (const pid of fp.patterns) {
        const c = pid.charAt(0);
        catBreakdown[c] = (catBreakdown[c] ?? 0) + 1;
      }
      const total = fp.patterns.length || 1;
      for (const [c, n] of Object.entries(catBreakdown)) {
        const seg = miniBar.createDiv('jp-ctx-mini-bar-seg');
        seg.style.width = `${(n / total) * 100}%`;
        seg.style.backgroundColor = CATEGORY_COLORS[c as PatternCategory] ?? '#95a5a6';
        seg.title = `${c}: ${CATEGORY_LABELS[c as PatternCategory] ?? c} (${n})`;
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════

  private posClass(pos: PartOfSpeech): string {
    const map: Record<string, string> = {
      [PartOfSpeech.Noun]: "noun", [PartOfSpeech.Verb]: "verb",
      [PartOfSpeech.Adjective_i]: "adj-i", [PartOfSpeech.Adjective_na]: "adj-na",
      [PartOfSpeech.Adverb]: "adv", [PartOfSpeech.Expression]: "expr",
    };
    return map[pos] ?? "other";
  }
}
