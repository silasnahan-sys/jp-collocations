/**
 * DictionaryView — mobile-first built-in dictionary viewer.
 *
 * Features:
 *   - Instant lookup with debounced search
 *   - Prefix autocomplete suggestions
 *   - Rich definition rendering (structured content, ruby, tables)
 *   - Pitch accent visualization (mora diagram)
 *   - Frequency badges
 *   - Tag pills
 *   - Dictionary source badges
 *   - Tap-to-expand definitions
 *   - Import dictionary button
 *   - Mobile-first with 48px touch targets, iOS safe areas
 */

import { ItemView, WorkspaceLeaf, Notice, Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { DictionaryStore } from '../dictionary/DictionaryStore';
import type {
  DictLookupResult,
  DictionaryMeta,
  DictionarySettings,
  YomitanDefinition,
  YomitanStructuredContent,
  YomitanContentNode,
  YomitanPitchInfo,
  YomitanTag,
} from '../dictionary/types';
import { YomitanImporter } from '../dictionary/YomitanImporter';
import { isExampleLine, exampleJapanese } from '../dictionary/example-capture';
import { ContextEngine } from '../context/ContextEngine';
import type { ContextCard, VaultOccurrence } from '../context/ContextEngine';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../discourse/discourse-grammar';
import { PATTERN_BY_ID, type PatternCategory } from '../discourse/discourse-patterns';
import { JP_COLLOCATIONS_VIEW_TYPE, CollocationView } from './CollocationView';
import { HoverPeek, definitionsPreview } from './hover-peek';

export const JP_DICTIONARY_VIEW_TYPE = 'jp-dictionary-view';

export class DictionaryView extends ItemView {
  private dictStore: DictionaryStore;
  private contextEngine: ContextEngine | null;
  private searchInput: HTMLInputElement | null = null;
  private suggestionsEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private headerActionsEl: HTMLElement | null = null;
  private breadcrumbEl: HTMLElement | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private currentQuery = '';
  /** Lookup history for recursive navigation */
  private lookupHistory: string[] = [];
  private onImport: () => Promise<void>;
  private onSaveEntry: (expression: string, reading: string, exampleSentence?: string) => void;
  /** Universal classify-capture (6分類 → pattern catalog; DESIGN §13). */
  private onClassify: ((expression: string, example?: string, dictMeta?: { dict: string; headword: string }) => void) | null;
  /** §26.3 hover peek — same shared component as the catalog (one grammar). */
  private peek: HoverPeek | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    dictStore: DictionaryStore,
    onImport: () => Promise<void>,
    onSaveEntry?: (expression: string, reading: string, exampleSentence?: string) => void,
    contextEngine?: ContextEngine,
    onClassify?: (expression: string, example?: string, dictMeta?: { dict: string; headword: string }) => void,
  ) {
    super(leaf);
    this.dictStore = dictStore;
    this.onImport = onImport;
    this.onSaveEntry = onSaveEntry ?? (() => {});
    this.contextEngine = contextEngine ?? null;
    this.onClassify = onClassify ?? null;
  }

  getViewType(): string { return JP_DICTIONARY_VIEW_TYPE; }
  getDisplayText(): string { return 'JP Dictionary'; }
  getIcon(): string { return 'book-open'; }

  async onOpen(): Promise<void> {
    this.buildUI();
    this.renderHome();
    // §23.5 keyboard hand: / focuses search; j/k walk the capturable example
    // rows; t (🏷️) captures the focused one — the same verbs as elsewhere.
    this.contentEl.setAttr('tabindex', '0');
    this.registerDomEvent(this.contentEl, 'keydown', (e) => this.onExampleKey(e));
    // §26.3 hover peek: dwell over any recursive-lookup word → reading+gloss
    // WITHOUT navigating away (keeps your place in the current entry — the
    // monokakido 飛び込み-without-losing-place feel). Mouse/Pencil only.
    this.peek = new HoverPeek((x, y) => {
      const span = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest?.('.jp-dict-clickable-word');
      const word = span?.textContent?.trim();
      if (!word) return null;
      const hits = this.dictStore.lookup(word);
      if (!hits.length) return null;
      const h = hits[0];
      return {
        headword: h.term.expression,
        reading: h.term.reading,
        deinflection: h.deinflection,
        def: definitionsPreview(h.term.definitions),
      };
    });
    this.peek.attach(this.contentEl, '.jp-dict-clickable-word');
  }

  private onExampleKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); this.searchInput?.focus(); return; }
    const rows = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.jp-dict-ex-capture'))
      .map((btn) => btn.parentElement)
      .filter((el): el is HTMLElement => !!el);
    if (!rows.length) return;
    const cur = rows.findIndex((r) => r.hasClass('jp-dict-ex--focus'));
    const k = e.key.toLowerCase();
    if (k === 'j' || k === 'k') {
      e.preventDefault();
      const from = cur < 0 ? (k === 'j' ? -1 : rows.length) : cur;
      const next = Math.max(0, Math.min(rows.length - 1, from + (k === 'j' ? 1 : -1)));
      rows.forEach((r) => r.removeClass('jp-dict-ex--focus'));
      rows[next].addClass('jp-dict-ex--focus');
      rows[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if ((k === 't' || e.key === 'Enter') && cur >= 0) {
      e.preventDefault();
      rows[cur].querySelector<HTMLElement>('.jp-dict-ex-capture')?.click();
    }
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.peek?.cancel();
  }

  refresh(): void {
    if (this.currentQuery) this.performLookup(this.currentQuery);
    else this.renderHome();
  }

  /** Public method for programmatic lookup (e.g. from editor selection command) */
  lookupWord(word: string): void {
    if (this.searchInput) this.searchInput.value = word;
    this.currentQuery = word;
    this.hideSuggestions();
    this.performLookup(word);
  }

  /**
   * Recursive lookup: push current query to history, then look up new word.
   * Used when tapping on Japanese text inside definitions.
   */
  private recursiveLookup(word: string): void {
    if (this.currentQuery && this.currentQuery !== word) {
      this.lookupHistory.push(this.currentQuery);
    }
    this.lookupWord(word);
    this.renderBreadcrumbs();
  }

  /** Navigate back in lookup history */
  private goBack(): void {
    const prev = this.lookupHistory.pop();
    if (prev) {
      this.lookupWord(prev);
      this.renderBreadcrumbs();
    }
  }

  /** Render breadcrumb navigation for recursive lookups */
  private renderBreadcrumbs(): void {
    if (!this.breadcrumbEl) return;
    this.breadcrumbEl.empty();

    if (this.lookupHistory.length === 0) {
      this.breadcrumbEl.style.display = 'none';
      return;
    }

    this.breadcrumbEl.style.display = 'flex';

    // Back button
    const backBtn = this.breadcrumbEl.createEl('button', {
      text: '◀ 戻る',
      cls: 'jp-dict-back-btn',
    });
    backBtn.addEventListener('click', () => this.goBack());

    // History trail
    for (let i = 0; i < this.lookupHistory.length; i++) {
      const crumb = this.breadcrumbEl.createEl('span', {
        text: this.lookupHistory[i],
        cls: 'jp-dict-breadcrumb-item',
      });
      crumb.addEventListener('click', () => {
        // Jump to this point in history
        const target = this.lookupHistory[i];
        this.lookupHistory = this.lookupHistory.slice(0, i);
        this.lookupWord(target);
        this.renderBreadcrumbs();
      });
      this.breadcrumbEl.createSpan({ text: ' → ', cls: 'jp-dict-breadcrumb-sep' });
    }

    // Current word (not clickable)
    this.breadcrumbEl.createEl('span', {
      text: this.currentQuery,
      cls: 'jp-dict-breadcrumb-current',
    });
  }

  /**
   * Make text elements with Japanese content clickable for recursive lookup.
   * This wraps runs of Japanese characters in <span> elements with click handlers.
   */
  private makeJapaneseClickable(el: HTMLElement): void {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent && /[\u3040-\u9fff\u30a0-\u30ff]/.test(node.textContent)) {
        textNodes.push(node);
      }
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      // Split into Japanese runs and non-Japanese runs
      const parts = text.split(/([\u3040-\u9fff\u30a0-\u30ff\u4e00-\u9faf]+)/g);
      if (parts.length <= 1) continue;

      const frag = document.createDocumentFragment();
      for (const part of parts) {
        if (/^[\u3040-\u9fff\u30a0-\u30ff\u4e00-\u9faf]+$/.test(part)) {
          const span = document.createElement('span');
          span.textContent = part;
          span.className = 'jp-dict-clickable-word';
          span.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.recursiveLookup(part);
          });
          frag.appendChild(span);
        } else {
          frag.appendChild(document.createTextNode(part));
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  // ── Build UI ───────────────────────────────────────────────

  private buildUI(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('jp-dict-view');

    // Header
    const header = container.createDiv('jp-dict-header');
    const titleRow = header.createDiv('jp-dict-title-row');
    titleRow.createEl('h4', { text: '辞書', cls: 'jp-dict-title' });
    this.headerActionsEl = titleRow.createDiv('jp-dict-header-actions');

    // Import button
    const importBtn = this.headerActionsEl.createEl('button', {
      text: '＋ Import',
      cls: 'jp-dict-import-btn',
      attr: { 'aria-label': 'Import Yomitan dictionary' },
    });
    importBtn.addEventListener('click', () => this.showImportDialog());

    // Manage button
    const manageBtn = this.headerActionsEl.createEl('button', {
      text: '⚙',
      cls: 'jp-dict-manage-btn',
      attr: { 'aria-label': 'Manage dictionaries' },
    });
    manageBtn.addEventListener('click', () => this.showManageDialog());

    // Search bar
    const searchRow = header.createDiv('jp-dict-search-row');
    this.searchInput = searchRow.createEl('input', {
      type: 'search',
      placeholder: '検索… (漢字・ひらがな・カタカナ)',
      cls: 'jp-dict-search-input',
      attr: {
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
      },
    });
    this.searchInput.addEventListener('input', () => this.onSearchInput());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.searchInput!.value = '';
        this.currentQuery = '';
        this.hideSuggestions();
        this.renderHome();
      }
    });

    // Clear button
    const clearBtn = searchRow.createEl('button', {
      text: '✕',
      cls: 'jp-dict-clear-btn',
      attr: { 'aria-label': 'Clear search' },
    });
    clearBtn.addEventListener('click', () => {
      if (this.searchInput) this.searchInput.value = '';
      this.currentQuery = '';
      this.hideSuggestions();
      this.renderHome();
      this.searchInput?.focus();
    });

    // Breadcrumb navigation for recursive lookups
    this.breadcrumbEl = container.createDiv('jp-dict-breadcrumbs');
    this.breadcrumbEl.style.display = 'none';

    // Suggestions dropdown
    this.suggestionsEl = container.createDiv('jp-dict-suggestions');
    this.suggestionsEl.style.display = 'none';

    // Stats
    this.statsEl = container.createDiv('jp-dict-stats');

    // Results
    this.resultsEl = container.createDiv('jp-dict-results');
  }

  // ── Search flow ────────────────────────────────────────────

  private onSearchInput(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    const query = this.searchInput?.value.trim() ?? '';

    if (!query) {
      this.currentQuery = '';
      this.hideSuggestions();
      this.renderHome();
      return;
    }

    // Live search: very short debounce (80ms) for alive feeling
    this.debounceTimer = setTimeout(() => {
      this.currentQuery = query;
      this.performLiveSearch(query);
    }, 80);
  }

  /**
   * Live search: show inline results as you type (no separate suggestions).
   * Uses substringSearch to catch partial/contains matches.
   */
  private performLiveSearch(query: string): void {
    this.hideSuggestions();
    if (!this.resultsEl || !this.statsEl) return;

    // Use substring search for fuzzy live results
    const results = this.dictStore.substringSearch(query, 20);

    // Also get exact match results for higher-quality display
    const exactResults = this.dictStore.lookup(query);

    // Merge: exact results first, then substring-only
    const merged = [...exactResults];
    const seen = new Set(exactResults.map(r => `${r.term.expression}|${r.term.reading}|${r.dictionary}`));
    for (const r of results) {
      const key = `${r.term.expression}|${r.term.reading}|${r.dictionary}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(r);
      }
    }

    this.statsEl.empty();

    if (!this.dictStore.hasDictionaries()) {
      this.statsEl.createSpan({ text: 'No dictionaries imported yet', cls: 'jp-dict-stat-text' });
      this.renderEmpty('Import a Yomitan dictionary to get started. Tap "＋ Import" above.');
      return;
    }

    if (merged.length === 0) {
      this.statsEl.createSpan({ text: `"${query}" — no results`, cls: 'jp-dict-stat-text' });
      this.renderEmpty(`"${query}" が見つかりませんでした`);
      return;
    }

    const grouped = this.groupResults(merged);
    this.statsEl.createSpan({
      text: `${merged.length} entries for "${query}"`,
      cls: 'jp-dict-stat-text',
    });

    this.resultsEl.empty();
    for (const group of grouped) {
      this.renderEntryCard(this.resultsEl, group);
    }
  }

  private showSuggestions(prefix: string): void {
    if (!this.suggestionsEl) return;
    const suggestions = this.dictStore.prefixSearch(prefix, 8);

    if (suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }

    this.suggestionsEl.empty();
    this.suggestionsEl.style.display = 'block';

    // Deduplicate by expression
    const seen = new Set<string>();
    for (const s of suggestions) {
      const key = s.term.expression;
      if (seen.has(key)) continue;
      seen.add(key);

      const row = this.suggestionsEl.createDiv('jp-dict-suggest-row');
      row.createSpan({ text: s.term.expression, cls: 'jp-dict-suggest-expr' });
      if (s.term.reading !== s.term.expression) {
        row.createSpan({ text: s.term.reading, cls: 'jp-dict-suggest-reading' });
      }
      if (s.frequency !== undefined) {
        row.createSpan({ text: `${s.frequency}`, cls: 'jp-dict-suggest-freq' });
      }

      row.addEventListener('click', () => {
        if (this.searchInput) this.searchInput.value = s.term.expression;
        this.currentQuery = s.term.expression;
        this.hideSuggestions();
        this.performLookup(s.term.expression);
      });
    }
  }

  private hideSuggestions(): void {
    if (this.suggestionsEl) {
      this.suggestionsEl.empty();
      this.suggestionsEl.style.display = 'none';
    }
  }

  private performLookup(query: string): void {
    this.hideSuggestions();
    if (!this.resultsEl || !this.statsEl) return;

    const results = this.dictStore.lookup(query);
    this.statsEl.empty();

    if (!this.dictStore.hasDictionaries()) {
      this.statsEl.createSpan({ text: 'No dictionaries imported yet', cls: 'jp-dict-stat-text' });
      this.renderEmpty('Import a Yomitan dictionary to get started. Tap "＋ Import" above.');
      return;
    }

    if (results.length === 0) {
      this.statsEl.createSpan({ text: `"${query}" — no results`, cls: 'jp-dict-stat-text' });
      this.renderEmpty(`"${query}" が見つかりませんでした`);
      return;
    }

    // Group by sequence & expression for merging related senses
    const grouped = this.groupResults(results);
    this.statsEl.createSpan({
      text: `${results.length} entries for "${query}"`,
      cls: 'jp-dict-stat-text',
    });

    this.resultsEl.empty();
    for (const group of grouped) {
      this.renderEntryCard(this.resultsEl, group);
    }
  }

  // ── Group results ──────────────────────────────────────────

  private groupResults(results: DictLookupResult[]): DictLookupResult[][] {
    const groups: DictLookupResult[][] = [];
    const groupMap = new Map<string, DictLookupResult[]>();

    for (const r of results) {
      // Group by expression + reading + sequence
      const key = `${r.term.expression}|${r.term.reading}|${r.term.sequence}|${r.dictionary}`;
      if (!groupMap.has(key)) {
        const group: DictLookupResult[] = [];
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key)!.push(r);
    }

    return groups;
  }

  // ── Render entry card ──────────────────────────────────────

  private renderEntryCard(parent: HTMLElement, group: DictLookupResult[]): void {
    const primary = group[0];
    const card = parent.createDiv('jp-dict-card');

    // ── Header: expression + reading ─────────────────────────
    const headerRow = card.createDiv('jp-dict-card-header');

    const exprEl = headerRow.createSpan({
      text: primary.term.expression,
      cls: 'jp-dict-card-expression',
    });

    if (primary.term.reading !== primary.term.expression) {
      headerRow.createSpan({
        text: primary.term.reading,
        cls: 'jp-dict-card-reading',
      });
    }

    // Deinflection trail: this hit was reached from an inflected query
    // (食べていた → 食べる) — show HOW so the form is itself a lesson.
    if (primary.deinflection?.length) {
      headerRow.createSpan({
        text: `〈${primary.deinflection.join(' + ')}〉`,
        cls: 'jp-dict-deinflect-badge',
        attr: { title: '入力は活用形でした — 辞書形に戻して照合' },
      });
    }

    // ── Meta row: frequency + tags + dict badge ──────────────
    const metaRow = card.createDiv('jp-dict-card-meta');

    if (primary.frequency !== undefined && this.dictStore.settings.showFrequency) {
      const freqBadge = metaRow.createSpan({ cls: 'jp-dict-freq-badge' });
      freqBadge.createSpan({ text: '⚡', cls: 'jp-dict-freq-icon' });
      freqBadge.createSpan({ text: `${primary.frequency}`, cls: 'jp-dict-freq-value' });
    }

    // Term tags
    for (const tag of primary.tags.slice(0, 5)) {
      const pill = metaRow.createSpan({
        text: tag.notes || tag.name,
        cls: `jp-dict-tag jp-dict-tag--${tag.category || 'default'}`,
        attr: { title: `${tag.name}: ${tag.notes}` },
      });
    }

    // Dictionary badge
    metaRow.createSpan({
      text: primary.dictionary,
      cls: 'jp-dict-dict-badge',
    });

    // ── Pitch accent ─────────────────────────────────────────
    if (primary.pitch && this.dictStore.settings.showPitch) {
      this.renderPitchAccent(card, primary.pitch, primary.term.reading || primary.term.expression);
    }

    // ── Definitions ──────────────────────────────────────────
    const defsSection = card.createDiv('jp-dict-defs');

    let defIndex = 0;
    for (const result of group) {
      for (const def of result.term.definitions) {
        defIndex++;
        const defRow = defsSection.createDiv('jp-dict-def-row');
        defRow.createSpan({ text: `${defIndex}.`, cls: 'jp-dict-def-num' });

        const defContent = defRow.createDiv('jp-dict-def-content');
        this.renderDefinition(defContent, def);
      }
    }

    // Make all Japanese text in definitions clickable for recursive lookup
    this.makeJapaneseClickable(defsSection);

    // §22.5: every example sentence is one 🏷️ from the catalog — the
    // dictionary as a mine. Curated stratum; the door leads back here.
    this.attachExampleCaptures(defsSection, group);

    // ── Copy button ──────────────────────────────────────────
    const actionsRow = card.createDiv('jp-dict-card-actions');

    const copyBtn = actionsRow.createEl('button', { text: 'Copy', cls: 'jp-dict-action-btn' });
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(primary.term.expression).then(() => {
        new Notice(`Copied: ${primary.term.expression}`);
      });
    });

    const insertBtn = actionsRow.createEl('button', { text: 'Insert', cls: 'jp-dict-action-btn' });
    insertBtn.addEventListener('click', () => {
      const editor = this.app.workspace.activeEditor?.editor;
      if (editor) {
        editor.replaceSelection(primary.term.expression);
        new Notice(`Inserted: ${primary.term.expression}`);
      }
    });

    // Save as collocation entry
    const saveBtn = actionsRow.createEl('button', { text: '💾 Save', cls: 'jp-dict-action-btn jp-dict-save-btn' });
    saveBtn.addEventListener('click', () => {
      // Extract first example sentence from definitions (structured content text)
      const exampleText = this.extractExampleFromDefs(group);
      this.onSaveEntry(
        primary.term.expression,
        primary.term.reading || primary.term.expression,
        exampleText,
      );
      new Notice(`Saved: ${primary.term.expression}`);
      saveBtn.textContent = '✓ Saved';
      saveBtn.disabled = true;
    });

    // Universal classify-capture: file this expression under one of the six
    // note classes (pattern catalog), with a definition example as context.
    if (this.onClassify) {
      const classifyBtn = actionsRow.createEl('button', { text: '🏷️ 分類', cls: 'jp-dict-action-btn' });
      classifyBtn.title = '6分類で台帳へ';
      classifyBtn.addEventListener('click', () => {
        this.onClassify!(primary.term.expression, this.extractExampleFromDefs(group) || undefined,
          { dict: group[0]?.dictionary ?? '辞書', headword: primary.term.expression });
      });
    }

    // ── Context Panel (lazy loaded on tap) ───────────────────
    if (this.contextEngine) {
      this.renderContextPanel(card, primary.term.expression);
    }
  }

  // ── Context Panel ──────────────────────────────────────────

  private renderContextPanel(card: HTMLElement, expression: string): void {
    const toggle = card.createDiv('jp-dict-ctx-toggle');
    toggle.createSpan({ text: '🔗 Context', cls: 'jp-dict-ctx-toggle-label' });
    toggle.createSpan({ text: '▸', cls: 'jp-dict-ctx-toggle-arrow' });

    let panelEl: HTMLElement | null = null;
    let loaded = false;

    toggle.addEventListener('click', async () => {
      if (panelEl) {
        const visible = panelEl.style.display !== 'none';
        panelEl.style.display = visible ? 'none' : '';
        toggle.querySelector('.jp-dict-ctx-toggle-arrow')!.textContent = visible ? '▸' : '▾';
        return;
      }
      if (loaded) return;
      loaded = true;
      toggle.querySelector('.jp-dict-ctx-toggle-arrow')!.textContent = '▾';

      panelEl = card.createDiv('jp-dict-ctx-panel');
      panelEl.createDiv({ text: 'Loading…', cls: 'jp-dict-ctx-loading' });

      try {
        const ctx = await this.contextEngine!.getContext(expression);
        panelEl.empty();
        this.fillContextPanel(panelEl, ctx, expression);
      } catch (e) {
        panelEl.empty();
        panelEl.createDiv({ text: 'Failed to load context', cls: 'jp-dict-ctx-error' });
      }
    });
  }

  private fillContextPanel(el: HTMLElement, ctx: ContextCard, expression: string): void {
    // ── Collocations ─────────────────────────────────────────
    if (ctx.collocations.length > 0 || ctx.surferEntries.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({ text: `コロケーション (${ctx.collocations.length + ctx.surferEntries.length})`, cls: 'jp-dict-ctx-section-title' });
      for (const c of ctx.collocations.slice(0, 6)) {
        const row = sec.createDiv('jp-dict-ctx-colloc-row');
        row.createSpan({ text: c.headword, cls: 'jp-dict-ctx-hw' });
        if (c.headwordReading) row.createSpan({ text: c.headwordReading, cls: 'jp-dict-ctx-rd' });
        if (c.exampleSentences.length > 0) {
          row.createDiv({ text: c.exampleSentences[0], cls: 'jp-dict-ctx-example' });
        }
      }
      for (const s of ctx.surferEntries.slice(0, 4)) {
        const row = sec.createDiv('jp-dict-ctx-colloc-row');
        row.createSpan({ text: s.surface, cls: 'jp-dict-ctx-hw' });
        if (s.exampleSentences && s.exampleSentences.length > 0) {
          row.createDiv({ text: s.exampleSentences[0].text.slice(0, 100), cls: 'jp-dict-ctx-example' });
        }
      }
    }

    // ── Vault Occurrences ─────────────────────────────────────
    if (ctx.vaultOccurrences.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({ text: `Vault (${ctx.vaultNoteCount} notes)`, cls: 'jp-dict-ctx-section-title' });
      for (const occ of ctx.vaultOccurrences.slice(0, 5)) {
        const row = sec.createDiv('jp-dict-ctx-vault-row');
        const link = row.createEl('a', { text: occ.fileName, cls: 'jp-dict-ctx-vault-link' });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const file = this.app.vault.getAbstractFileByPath(occ.filePath);
          if (file) {
            this.app.workspace.openLinkText(occ.filePath, '', false);
          }
        });
        if (occ.context) {
          row.createDiv({ text: occ.context, cls: 'jp-dict-ctx-snippet' });
        }
        if (occ.nearbyPatterns.length > 0) {
          const pills = row.createDiv('jp-dict-ctx-pattern-pills');
          for (const pid of occ.nearbyPatterns.slice(0, 3)) {
            const pat = PATTERN_BY_ID.get(pid);
            if (!pat) continue;
            const color = CATEGORY_COLORS[pat.category as PatternCategory] || '#888';
            const pill = pills.createSpan({ text: pat.surface, cls: 'jp-dict-ctx-pattern-pill' });
            pill.style.borderColor = color;
            pill.style.color = color;
          }
        }
      }
    }

    // ── Typed bit-relations (sidecar) ────────────────────────
    if (ctx.bitRelations.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({
        text: `✓ 型付き関係 (${ctx.bitRelations.length}) サイドカー`,
        cls: 'jp-dict-ctx-section-title',
      });
      const list = sec.createDiv('jp-dict-ctx-bitrel-list');
      for (const br of ctx.bitRelations.slice(0, 8)) {
        const row = list.createDiv('jp-dict-ctx-bitrel-row');
        row.dataset.reconciliation = br.reconciliation ?? 'unknown';
        row.title =
          `${br.label.replace(/_/g, ' ')} · reconciliation: ${br.reconciliation ?? 'n/a'} · ` +
          `conf ${(br.confidence ?? 0).toFixed(2)}`;
        row.createSpan({ text: br.label.replace(/_/g, ' '), cls: 'jp-dict-ctx-bitrel-label' });
        const pair = row.createDiv('jp-dict-ctx-bitrel-pair');
        pair.createSpan({
          text: br.sourceSurface,
          cls: br.matchedRole === 'source'
            ? 'jp-dict-ctx-bitrel-endpoint jp-dict-ctx-bitrel-endpoint--matched'
            : 'jp-dict-ctx-bitrel-endpoint',
        });
        pair.createSpan({ text: '→', cls: 'jp-dict-ctx-bitrel-arrow' });
        pair.createSpan({
          text: br.targetSurface,
          cls: br.matchedRole === 'target'
            ? 'jp-dict-ctx-bitrel-endpoint jp-dict-ctx-bitrel-endpoint--matched'
            : 'jp-dict-ctx-bitrel-endpoint',
        });
      }
    }

    // ── Co-occurring Patterns ────────────────────────────────
    if (ctx.coPatterns.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({ text: `共起パターン (${ctx.patternCount})`, cls: 'jp-dict-ctx-section-title' });
      const grid = sec.createDiv('jp-dict-ctx-copat-grid');
      for (const cp of ctx.coPatterns.slice(0, 8)) {
        const chip = grid.createDiv('jp-dict-ctx-copat-chip');
        const color = CATEGORY_COLORS[cp.category as PatternCategory] || '#888';
        chip.style.borderLeft = `3px solid ${color}`;
        chip.createSpan({ text: cp.surface, cls: 'jp-dict-ctx-copat-surface' });
        chip.createSpan({ text: `×${cp.count}`, cls: 'jp-dict-ctx-copat-count' });
      }
    }

    // ── X usage examples ─────────────────────────────────────
    const xExamples = ctx.examples.filter(e => e.source === 'x');
    if (xExamples.length > 0) {
      const sec = el.createDiv('jp-dict-ctx-section');
      sec.createDiv({ text: `𝕏 用例 (${xExamples.length})`, cls: 'jp-dict-ctx-section-title' });
      for (const ex of xExamples.slice(0, 6)) {
        const row = sec.createDiv('jp-dict-ctx-x-row');
        row.createDiv({ text: ex.text.slice(0, 140), cls: 'jp-dict-ctx-x-text' });
        const meta = row.createDiv('jp-dict-ctx-x-meta');
        if (ex.patterns.length > 0) {
          const seen = new Set<string>();
          for (const m of ex.patterns.slice(0, 4)) {
            if (seen.has(m.pattern.id)) continue;
            seen.add(m.pattern.id);
            const color = CATEGORY_COLORS[m.pattern.category as PatternCategory] || '#888';
            const pill = meta.createSpan({ text: m.pattern.surface, cls: 'jp-dict-ctx-pattern-pill' });
            pill.style.borderColor = color;
            pill.style.color = color;
          }
        }
        const link = meta.createEl('a', { text: '↗ X', cls: 'jp-dict-ctx-x-link' });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (ex.sourceDetail) window.open(ex.sourceDetail, '_blank');
        });
      }
    }

    // ── Open in Lexicon button ───────────────────────────────
    const navRow = el.createDiv('jp-dict-ctx-nav');
    const lexBtn = navRow.createEl('button', { text: '📖 Open in Lexicon', cls: 'jp-dict-action-btn jp-dict-ctx-lexicon-btn' });
    lexBtn.addEventListener('click', () => {
      this.navigateToLexicon(expression);
    });
  }

  private navigateToLexicon(query: string): void {
    const leaves = this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      (leaves[0].view as CollocationView).openContextCard(query);
    } else {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        leaf.setViewState({ type: JP_COLLOCATIONS_VIEW_TYPE, active: true }).then(() => {
          this.app.workspace.revealLeaf(leaf);
          setTimeout(() => {
            (leaf.view as CollocationView).openContextCard(query);
          }, 200);
        });
      }
    }
  }

  /** §22.5: attach a quiet 🏷️ to each LEAF block that reads as an example
   *  sentence. Leaf-only + containment dedupe so nested structured content
   *  never doubles up. */
  private attachExampleCaptures(root: HTMLElement, group: DictLookupResult[]): void {
    if (!this.onClassify) return;
    const dict = group[0]?.dictionary ?? '辞書';
    const headword = group[0]?.term.expression ?? '';
    const claimed: HTMLElement[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('li, p, div, span'))) {
      if (el.querySelector('li, p, div')) continue;                    // leaves only
      const text = el.textContent?.trim() ?? '';
      if (!isExampleLine(text)) continue;
      const jp = exampleJapanese(text);
      if (jp === headword) continue;                                   // the headword itself is not an example
      if (claimed.some((c) => c.contains(el) || el.contains(c))) continue;
      claimed.push(el);
      const btn = el.createEl('button', { text: '🏷️', cls: 'jp-dict-ex-capture' });
      btn.setAttribute('aria-label', 'この用例を台帳へ（📖 辞書層）（キー: j/k で選択 → t）');
      btn.setAttribute('title', 'この用例を台帳へ（キー: j/k → t）');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClassify!(jp, text, { dict, headword });
      });
    }
  }

  /** Try to extract an example sentence from structured definitions */
  private extractExampleFromDefs(group: DictLookupResult[]): string | undefined {
    for (const result of group) {
      for (const def of result.term.definitions) {
        const text = this.extractExampleFromContent(def);
        if (text) return text;
      }
    }
    return undefined;
  }

  private extractExampleFromContent(def: YomitanDefinition): string | undefined {
    if (typeof def === 'string') return undefined;
    if (Array.isArray(def)) return undefined;
    if (def.type === 'structured-content' && def.content) {
      return this.findExampleInStructured(def.content);
    }
    return undefined;
  }

  private findExampleInStructured(content: YomitanStructuredContent): string | undefined {
    if (typeof content === 'string') {
      // Heuristic: example sentences tend to be longer and contain Japanese
      if (content.length > 10 && /[\u3040-\u309f]/.test(content) && /[。？！]/.test(content)) {
        return content;
      }
      return undefined;
    }
    if (Array.isArray(content)) {
      for (const child of content) {
        const found = this.findExampleInStructured(child);
        if (found) return found;
      }
      return undefined;
    }
    const node = content as YomitanContentNode;
    // Look for elements with example-related data attributes or classes
    if (node.data?.['content'] === 'example' || node.data?.['sga-type'] === 'example') {
      return this.collectText(node.content);
    }
    if (node.content) {
      return this.findExampleInStructured(node.content);
    }
    return undefined;
  }

  private collectText(content: YomitanStructuredContent | undefined): string | undefined {
    if (!content) return undefined;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(c => this.collectText(c)).filter(Boolean).join('');
    }
    if ((content as YomitanContentNode).content) {
      return this.collectText((content as YomitanContentNode).content);
    }
    return undefined;
  }

  // ── Render definition ──────────────────────────────────────

  private renderDefinition(parent: HTMLElement, def: YomitanDefinition): void {
    if (typeof def === 'string') {
      parent.createSpan({ text: def, cls: 'jp-dict-def-text' });
      return;
    }

    if (Array.isArray(def)) {
      // Deinflection tuple
      parent.createSpan({ text: `→ ${def[0]}`, cls: 'jp-dict-def-deinflect' });
      if (def[1].length > 0) {
        parent.createSpan({ text: ` (${def[1].join(' → ')})`, cls: 'jp-dict-def-rules' });
      }
      return;
    }

    if (def.type === 'text' && def.text) {
      parent.createSpan({ text: def.text, cls: 'jp-dict-def-text' });
      return;
    }

    if (def.type === 'structured-content' && def.content) {
      this.renderStructuredContent(parent, def.content);
      return;
    }

    if (def.type === 'image') {
      parent.createSpan({ text: '[image]', cls: 'jp-dict-def-text jp-dict-def-image' });
      return;
    }

    // Fallback: stringify
    const text = DictionaryStore.definitionToText(def);
    if (text) parent.createSpan({ text, cls: 'jp-dict-def-text' });
  }

  // ── Render structured content ──────────────────────────────

  private renderStructuredContent(parent: HTMLElement, content: YomitanStructuredContent): void {
    if (typeof content === 'string') {
      parent.appendText(content);
      return;
    }

    if (Array.isArray(content)) {
      for (const child of content) {
        this.renderStructuredContent(parent, child);
      }
      return;
    }

    // It's a node object
    const node = content as YomitanContentNode;
    const { tag } = node;

    if (tag === 'br') {
      parent.createEl('br');
      return;
    }

    // Map to safe HTML elements
    const safeTagMap: Record<string, keyof HTMLElementTagNameMap> = {
      span: 'span', div: 'div', ol: 'ol', ul: 'ul', li: 'li',
      ruby: 'ruby', rt: 'rt', rp: 'rp',
      table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tfoot',
      tr: 'tr', td: 'td', th: 'th',
      details: 'details', summary: 'summary',
    };

    const htmlTag = safeTagMap[tag];
    if (htmlTag) {
      const el = parent.createEl(htmlTag, { cls: 'jp-dict-sc' });

      // Apply inline styles (limited safe subset)
      if (node.style) {
        this.applyStyles(el, node.style);
      }

      if (node.title) el.title = node.title;

      // data attributes
      if (node.data) {
        for (const [k, v] of Object.entries(node.data)) {
          el.dataset[k] = v;
        }
        // §22.5: example sentences are FIRST-CLASS rows — dictionaries mark
        // them via data attributes (Yomitan: content=example / sga-type=example)
        const dv = Object.values(node.data);
        if (dv.includes('example') || dv.includes('example-sentence') || dv.includes('examples')) {
          el.addClass('jp-dict-sc--example');
        }
      }

      if (node.content) {
        this.renderStructuredContent(el, node.content);
      }
      return;
    }

    // Link tag
    if (tag === 'a' && node.href) {
      // Internal dictionary links start with ?
      if (node.href.startsWith('?')) {
        const linkEl = parent.createEl('a', { cls: 'jp-dict-internal-link' });
        linkEl.textContent = '';
        if (node.content) this.renderStructuredContent(linkEl, node.content);
        linkEl.addEventListener('click', (e) => {
          e.preventDefault();
          const target = node.href!.slice(1); // remove leading ?
          const parts = new URLSearchParams(target);
          const query = parts.get('query') || parts.get('term') || decodeURIComponent(target);
          if (query) {
            this.recursiveLookup(query);
          }
        });
        return;
      }
      // External links — render as text (no external nav from plugin)
      const span = parent.createSpan({ cls: 'jp-dict-ext-link' });
      if (node.content) this.renderStructuredContent(span, node.content);
      return;
    }

    // Image
    if (tag === 'img') {
      parent.createSpan({ text: '[img]', cls: 'jp-dict-def-image' });
      return;
    }

    // Unknown tag — render content as text
    if (node.content) {
      this.renderStructuredContent(parent, node.content);
    }
  }

  private applyStyles(el: HTMLElement, style: Record<string, string | number>): void {
    // Only apply safe CSS properties
    const safe: Record<string, string> = {
      fontStyle: 'font-style',
      fontWeight: 'font-weight',
      fontSize: 'font-size',
      color: 'color',
      backgroundColor: 'background-color',
      textDecorationLine: 'text-decoration-line',
      textDecorationStyle: 'text-decoration-style',
      verticalAlign: 'vertical-align',
      textAlign: 'text-align',
      listStyleType: 'list-style-type',
    };
    for (const [key, cssName] of Object.entries(safe)) {
      if (key in style) {
        el.style.setProperty(cssName, String(style[key]));
      }
    }
  }

  // ── Pitch accent rendering ─────────────────────────────────

  private renderPitchAccent(parent: HTMLElement, pitch: YomitanPitchInfo, reading: string): void {
    const pitchContainer = parent.createDiv('jp-dict-pitch-container');

    for (const p of pitch.pitches) {
      const moraRow = pitchContainer.createDiv('jp-dict-pitch-row');

      // Split reading into morae
      const morae = this.splitMorae(reading);
      const position = typeof p.position === 'number' ? p.position : -1;

      // Pitch pattern: determine high/low for each mora
      for (let i = 0; i < morae.length; i++) {
        const mora = morae[i];
        const isHigh = this.isMoraHigh(i, position, morae.length);
        const moraEl = moraRow.createSpan({
          text: mora,
          cls: `jp-dict-pitch-mora ${isHigh ? 'jp-dict-pitch-high' : 'jp-dict-pitch-low'}`,
        });

        // Draw connector line
        if (i < morae.length - 1) {
          const nextHigh = this.isMoraHigh(i + 1, position, morae.length);
          if (isHigh !== nextHigh) {
            moraRow.createSpan({ cls: 'jp-dict-pitch-drop' });
          }
        }
      }

      // Label
      if (position === 0) {
        moraRow.createSpan({ text: '(平板)', cls: 'jp-dict-pitch-label' });
      } else if (position === 1) {
        moraRow.createSpan({ text: '(頭高)', cls: 'jp-dict-pitch-label' });
      } else if (position === morae.length) {
        moraRow.createSpan({ text: '(尾高)', cls: 'jp-dict-pitch-label' });
      } else if (position > 0) {
        moraRow.createSpan({ text: '(中高)', cls: 'jp-dict-pitch-label' });
      }
    }
  }

  private isMoraHigh(index: number, downstep: number, totalMorae: number): boolean {
    if (downstep === 0) {
      // Heiban: first mora low, rest high
      return index > 0;
    }
    if (downstep === 1) {
      // Atamadaka: first mora high, rest low
      return index === 0;
    }
    // Nakadaka / Odaka: first mora low, high until downstep, then low
    return index > 0 && index < downstep;
  }

  private splitMorae(text: string): string[] {
    const morae: string[] = [];
    const small = new Set('ゃゅょャュョぁぃぅぇぉァィゥェォっッ');
    for (let i = 0; i < text.length; i++) {
      if (i > 0 && small.has(text[i])) {
        morae[morae.length - 1] += text[i];
      } else {
        morae.push(text[i]);
      }
    }
    return morae;
  }

  // ── Home / empty states ────────────────────────────────────

  private renderHome(): void {
    if (!this.resultsEl || !this.statsEl) return;

    this.statsEl.empty();
    this.resultsEl.empty();

    if (!this.dictStore.hasDictionaries()) {
      this.statsEl.createSpan({ text: 'No dictionaries loaded', cls: 'jp-dict-stat-text' });

      const empty = this.resultsEl.createDiv('jp-dict-empty-state');
      empty.createDiv({ cls: 'jp-dict-empty-icon', text: '📚' });
      empty.createEl('h5', { text: 'Import a Yomitan Dictionary' });
      empty.createEl('p', {
        text: 'Import .zip files exported from Yomitan/Yomichan (JMdict, JMnedict, KANJIDIC, etc.).',
        cls: 'jp-dict-empty-desc',
      });
      const importBtn = empty.createEl('button', {
        text: '＋ Import Dictionary',
        cls: 'jp-dict-import-btn jp-dict-import-btn--large',
      });
      importBtn.addEventListener('click', () => this.showImportDialog());
      return;
    }

    // Show dictionary stats
    const dicts = this.dictStore.getDictionaryList();
    const total = this.dictStore.getTotalTermCount();
    this.statsEl.createSpan({
      text: `${dicts.length} dict${dicts.length !== 1 ? 's' : ''} · ${total.toLocaleString()} terms`,
      cls: 'jp-dict-stat-text',
    });

    // Dictionary cards
    const home = this.resultsEl.createDiv('jp-dict-home');
    home.createEl('p', {
      text: 'Type to search across all imported dictionaries.',
      cls: 'jp-dict-home-hint',
    });

    for (const meta of dicts) {
      const dictCard = home.createDiv('jp-dict-info-card');
      const row = dictCard.createDiv('jp-dict-info-row');
      row.createSpan({ text: '📖', cls: 'jp-dict-info-icon' });
      const info = row.createDiv('jp-dict-info-text');
      info.createEl('strong', { text: meta.title });
      info.createSpan({ text: ` · ${meta.termCount.toLocaleString()} terms`, cls: 'jp-dict-info-count' });

      if (meta.description) {
        dictCard.createEl('p', {
          text: meta.description.slice(0, 120) + (meta.description.length > 120 ? '…' : ''),
          cls: 'jp-dict-info-desc',
        });
      }

      const badges = dictCard.createDiv('jp-dict-info-badges');
      if (meta.hasFrequency) badges.createSpan({ text: '⚡ Frequency', cls: 'jp-dict-info-badge' });
      if (meta.hasPitch) badges.createSpan({ text: '🎵 Pitch', cls: 'jp-dict-info-badge' });
      badges.createSpan({ text: `v${meta.revision}`, cls: 'jp-dict-info-badge' });
    }
  }

  private renderEmpty(message: string): void {
    if (!this.resultsEl) return;
    this.resultsEl.empty();
    this.resultsEl.createDiv({ text: message, cls: 'jp-dict-empty' });
  }

  // ── Import dialog ──────────────────────────────────────────

  private showImportDialog(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          new Notice(`Importing ${file.name}…`, 0);
          const buf = await file.arrayBuffer();
          const importer = new YomitanImporter();
          const data = await importer.import(buf, (msg) => {
            new Notice(msg, 3000);
          });
          // §27.5 / AUDIT §18: a dictionary this large cannot live in the
          // plugin data blob. On 2026-07-25 one did, reached 239MB, its
          // whole-file rewrite was truncated, and the plugin stopped loading.
          // Say so BEFORE importing rather than after the damage.
          if (data.terms.length > DictionaryStore.BLOB_TERM_LIMIT) {
            new Notice(
              `「${data.meta.title}」は ${data.terms.length.toLocaleString()} 語 — 大きすぎるため` +
              `プラグインのデータに保存できません（${DictionaryStore.BLOB_TERM_LIMIT.toLocaleString()}語まで）。\n` +
              `設定 → 大型辞書 で「Yomitan書き出しフォルダ」を指定し、金庫内シャードに変換してください。`,
              15000,
            );
            continue;
          }
          this.dictStore.addDictionary(data);
          await this.onImport();
          new Notice(`✓ Imported "${data.meta.title}" (${data.meta.termCount.toLocaleString()} terms)`, 5000);
        } catch (err) {
          console.error('Dictionary import error:', err);
          new Notice(`Failed to import ${file.name}: ${(err as Error).message}`, 8000);
        }
      }

      this.renderHome();
    };
    input.click();
  }

  // ── Manage dialog ──────────────────────────────────────────

  private showManageDialog(): void {
    new DictManageModal(this.app, this.dictStore, async () => {
      await this.onImport();
      this.renderHome();
    }).open();
  }
}

// ── Manage Modal ─────────────────────────────────────────────

class DictManageModal extends Modal {
  private dictStore: DictionaryStore;
  private onSave: () => Promise<void>;

  constructor(app: App, dictStore: DictionaryStore, onSave: () => Promise<void>) {
    super(app);
    this.dictStore = dictStore;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('jp-dict-manage-modal');
    contentEl.createEl('h2', { text: 'Manage Dictionaries' });

    const dicts = this.dictStore.getDictionaryList();

    if (dicts.length === 0) {
      contentEl.createEl('p', { text: 'No dictionaries imported.', cls: 'jp-dict-empty' });
      return;
    }

    for (const meta of dicts) {
      const isEnabled = this.dictStore.settings.enabledDictionaries.includes(meta.title);

      new Setting(contentEl)
        .setName(meta.title)
        .setDesc(`${meta.termCount.toLocaleString()} terms · v${meta.revision}`)
        .addToggle(t => t.setValue(isEnabled).onChange(async (v) => {
          if (v) {
            if (!this.dictStore.settings.enabledDictionaries.includes(meta.title)) {
              this.dictStore.settings.enabledDictionaries.push(meta.title);
            }
          } else {
            this.dictStore.settings.enabledDictionaries =
              this.dictStore.settings.enabledDictionaries.filter(t => t !== meta.title);
          }
          await this.onSave();
        }))
        .addButton(b => b.setButtonText('Remove').setWarning().onClick(async () => {
          this.dictStore.removeDictionary(meta.title);
          await this.onSave();
          this.onOpen(); // refresh
        }));
    }

    // Settings
    contentEl.createEl('h3', { text: 'Display' });

    new Setting(contentEl)
      .setName('Show pitch accent')
      .addToggle(t => t.setValue(this.dictStore.settings.showPitch).onChange(async (v) => {
        this.dictStore.settings.showPitch = v;
        await this.onSave();
      }));

    new Setting(contentEl)
      .setName('Show frequency')
      .addToggle(t => t.setValue(this.dictStore.settings.showFrequency).onChange(async (v) => {
        this.dictStore.settings.showFrequency = v;
        await this.onSave();
      }));

    new Setting(contentEl)
      .setName('Max results')
      .addSlider(s => s.setLimits(10, 200, 10)
        .setValue(this.dictStore.settings.maxResults)
        .setDynamicTooltip()
        .onChange(async (v) => {
          this.dictStore.settings.maxResults = v;
          await this.onSave();
        }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
