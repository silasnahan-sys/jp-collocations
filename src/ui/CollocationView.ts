import { ItemView, WorkspaceLeaf, Menu, Notice } from "obsidian";
import type { App } from "obsidian";
import type { CollocationEntry, PluginSettings, SearchResult, DiscourseContext, DiscourseCategory } from "../types.ts";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { SearchEngine } from "../search/SearchEngine.ts";
import type { DiscourseStore } from "../data/DiscourseStore.ts";
import { AddEntryModal } from "./AddEntryModal.ts";

export const JP_COLLOCATIONS_VIEW_TYPE = "jp-collocations-view";

export class CollocationView extends ItemView {
  private store: CollocationStore;
  private engine: SearchEngine;
  private settings: PluginSettings;
  private discourseStore: DiscourseStore | null;
  private results: SearchResult[] = [];
  private currentPOSFilter: PartOfSpeech[] = [];
  private currentTagFilter: string[] = [];
  private searchInput: HTMLInputElement | null = null;
  private resultContainer: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;
  private discourseFilterMarker = "";
  private discourseFilterCategory: DiscourseCategory | "" = "";

  constructor(
    leaf: WorkspaceLeaf,
    store: CollocationStore,
    engine: SearchEngine,
    settings: PluginSettings,
    discourseStore?: DiscourseStore
  ) {
    super(leaf);
    this.store = store;
    this.engine = engine;
    this.settings = settings;
    this.discourseStore = discourseStore ?? null;
  }

  getViewType(): string {
    return JP_COLLOCATIONS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "JP Collocations";
  }

  getIcon(): string {
    return "languages";
  }

  async onOpen(): Promise<void> {
    this.buildUI();
    this.refresh();
  }

  async onClose(): Promise<void> {
    // nothing
  }

  private buildUI(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-collocations-view");

    // Header
    const header = container.createDiv("jp-col-header");
    header.createEl("h4", { text: "JP Collocations", cls: "jp-col-title" });

    // Search bar
    const searchRow = container.createDiv("jp-col-search-row");
    this.searchInput = searchRow.createEl("input", {
      type: "text",
      placeholder: "Search collocations... (JP/EN/romaji)",
      cls: "jp-col-search-input",
    });
    this.searchInput.addEventListener("input", () => this.refresh());

    const addBtn = searchRow.createEl("button", { text: "+", cls: "jp-col-add-btn", title: "Add entry" });
    addBtn.addEventListener("click", () => {
      new AddEntryModal(this.app, this.store, () => this.refresh()).open();
    });

    // POS filter chips
    const filterRow = container.createDiv("jp-col-filter-row");
    this.buildPOSChips(filterRow);

    // Discourse filter row (shown only when discourse store is available)
    if (this.discourseStore && this.settings.showDiscourseContexts) {
      const discourseRow = container.createDiv("jp-col-discourse-filter-row");
      discourseRow.createSpan({ text: "談話:", cls: "jp-col-discourse-filter-label" });

      const markerInput = discourseRow.createEl("input", {
        type: "text",
        placeholder: "marker surface…",
        cls: "jp-col-discourse-filter-input",
      });
      markerInput.addEventListener("input", () => {
        this.discourseFilterMarker = markerInput.value.trim();
        this.refresh();
      });

      const categorySelect = discourseRow.createEl("select", { cls: "jp-col-discourse-filter-select" });
      const blankOpt = categorySelect.createEl("option", { text: "All categories", value: "" });
      blankOpt.value = "";
      const categories: DiscourseCategory[] = [
        "topic-initiation", "reasoning", "modality", "connective",
        "confirmation", "rephrasing", "filler", "quotation",
      ];
      for (const cat of categories) {
        categorySelect.createEl("option", { text: cat, value: cat });
      }
      categorySelect.addEventListener("change", () => {
        this.discourseFilterCategory = categorySelect.value as DiscourseCategory | "";
        this.refresh();
      });
    }

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

    // Clear filters button
    const clearBtn = parent.createEl("span", { text: "✕ clear", cls: "jp-col-chip jp-col-chip--clear" });
    clearBtn.addEventListener("click", () => {
      this.currentPOSFilter = [];
      this.currentTagFilter = [];
      parent.querySelectorAll(".jp-col-chip--active").forEach(el => el.removeClass("jp-col-chip--active"));
      this.refresh();
    });
  }

  refresh(): void {
    const query = this.searchInput?.value ?? "";

    // Apply discourse filters if active
    if (this.discourseStore && (this.discourseFilterMarker || this.discourseFilterCategory)) {
      const exprToId = this.discourseStore.buildExpressionToIdMap();
      let filteredIds: Set<string> | null = null;

      if (this.discourseFilterMarker) {
        const markerEntries = this.discourseStore.getEntriesByMarker(this.discourseFilterMarker);
        const ids = new Set(markerEntries.map(e => exprToId.get(e.expression) ?? "").filter(Boolean));
        filteredIds = ids;
      }

      if (this.discourseFilterCategory) {
        const catEntries = this.discourseStore.getEntriesByCategory(this.discourseFilterCategory as DiscourseCategory);
        const ids = new Set(catEntries.map(e => exprToId.get(e.expression) ?? "").filter(Boolean));
        if (filteredIds) {
          // Intersection
          for (const id of filteredIds) {
            if (!ids.has(id)) filteredIds.delete(id);
          }
        } else {
          filteredIds = ids;
        }
      }

      if (filteredIds) {
        const allResults = this.engine.search({
          query,
          posFilter: this.currentPOSFilter.length ? this.currentPOSFilter : undefined,
          tagFilter: this.currentTagFilter.length ? this.currentTagFilter : undefined,
          fuzzy: true,
          maxResults: this.settings.maxResults,
          sortBy: this.settings.defaultSortOrder,
        });
        this.results = allResults.filter(r => (filteredIds as Set<string>).has(r.entry.id));
        this.renderStats();
        this.renderResults();
        return;
      }
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
    this.statsEl.createSpan({ text: `${this.results.length} / ${stats.total} entries`, cls: "jp-col-stat-text" });
  }

  private renderResults(): void {
    if (!this.resultContainer) return;
    this.resultContainer.empty();

    if (this.results.length === 0) {
      this.resultContainer.createDiv({ text: "No results found.", cls: "jp-col-empty" });
      return;
    }

    for (const result of this.results) {
      this.renderEntry(this.resultContainer, result.entry);
    }
  }

  private renderEntry(parent: HTMLElement, entry: CollocationEntry): void {
    const card = parent.createDiv("jp-col-card");

    const mainRow = card.createDiv("jp-col-card-main");

    // Headword
    const hwSpan = mainRow.createSpan({ cls: "jp-col-headword", text: entry.headword });
    if (this.settings.showReadings && entry.headwordReading) {
      mainRow.createSpan({ cls: "jp-col-reading", text: `（${entry.headwordReading}）` });
    }

    // Collocate
    mainRow.createSpan({ cls: "jp-col-collocate", text: " " + entry.collocate });

    // POS badge
    mainRow.createSpan({ cls: `jp-col-pos jp-col-pos--${this.posClass(entry.headwordPOS)}`, text: entry.headwordPOS });

    // Pattern
    if (entry.pattern) {
      mainRow.createSpan({ cls: "jp-col-pattern", text: entry.pattern });
    }

    // Actions
    const actRow = card.createDiv("jp-col-actions");
    this.buildActions(actRow, entry);

    // Expandable details
    if (entry.exampleSentences.length > 0 || entry.notes) {
      const details = card.createEl("details", { cls: "jp-col-details" });
      details.createEl("summary", { text: "examples / notes" });
      for (const s of entry.exampleSentences) {
        details.createEl("p", { text: s, cls: "jp-col-example" });
      }
      if (entry.notes) {
        details.createEl("p", { text: entry.notes, cls: "jp-col-notes" });
      }
    }

    // Discourse contexts section
    if (this.discourseStore && this.settings.showDiscourseContexts) {
      const contexts = this.discourseStore.getContextsForCollocation(entry.id);
      if (contexts.length > 0) {
        this.renderDiscourseContexts(card, contexts);
      }
    }
  }

  private buildActions(parent: HTMLElement, entry: CollocationEntry): void {
    const copyBtn = parent.createEl("button", { text: "Copy", cls: "jp-col-action-btn" });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(entry.fullPhrase).then(() => {
        new Notice(`Copied: ${entry.fullPhrase}`);
      }).catch(() => {
        new Notice("Copy failed.");
      });
    });

    const insertBtn = parent.createEl("button", { text: "Insert", cls: "jp-col-action-btn" });
    insertBtn.addEventListener("click", () => {
      const editor = this.app.workspace.activeEditor?.editor;
      if (editor) {
        editor.replaceSelection(entry.fullPhrase);
        new Notice(`Inserted: ${entry.fullPhrase}`);
      } else {
        new Notice("No active editor.");
      }
    });

    const editBtn = parent.createEl("button", { text: "Edit", cls: "jp-col-action-btn" });
    editBtn.addEventListener("click", () => {
      new AddEntryModal(this.app, this.store, () => this.refresh(), entry).open();
    });

    const delBtn = parent.createEl("button", { text: "×", cls: "jp-col-action-btn jp-col-action-btn--danger" });
    delBtn.addEventListener("click", () => {
      this.store.delete(entry.id);
      new Notice(`Deleted: ${entry.fullPhrase}`);
      this.refresh();
    });
  }

  private posClass(pos: PartOfSpeech): string {
    const map: Record<string, string> = {
      [PartOfSpeech.Noun]: "noun",
      [PartOfSpeech.Verb]: "verb",
      [PartOfSpeech.Adjective_i]: "adj-i",
      [PartOfSpeech.Adjective_na]: "adj-na",
      [PartOfSpeech.Adverb]: "adv",
      [PartOfSpeech.Expression]: "expr",
    };
    return map[pos] ?? "other";
  }

  private renderDiscourseContexts(parent: HTMLElement, contexts: DiscourseContext[]): void {
    const details = parent.createEl("details", { cls: "jp-col-details jp-discourse-contexts-details" });
    const summary = details.createEl("summary");
    summary.createSpan({ text: `談話コンテキスト `, cls: "jp-discourse-summary-label" });
    summary.createSpan({
      text: `(${contexts.length})`,
      cls: "jp-discourse-context-count",
    });

    for (const ctx of contexts) {
      const ctxCard = details.createDiv("jp-discourse-context-card");

      // Granularity badge + source
      const metaRow = ctxCard.createDiv("jp-discourse-context-meta");
      metaRow.createSpan({ text: ctx.granularity, cls: "jp-discourse-granularity-badge" });
      const srcText = ctx.source.ytTimestamp
        ? `${ctx.source.file} @${ctx.source.ytTimestamp}`
        : ctx.source.file;
      const srcSpan = metaRow.createSpan({ text: srcText, cls: "jp-discourse-source-link" });
      if (ctx.source.ytUrl) {
        srcSpan.setAttribute("title", ctx.source.ytUrl);
      }
      srcSpan.addEventListener("click", () => {
        if (ctx.source.ytUrl) {
          window.open(ctx.source.ytUrl, "_blank");
        } else {
          const file = this.app.vault.getFileByPath(ctx.source.file);
          if (file) this.app.workspace.openLinkText(ctx.source.file, "", false);
        }
      });

      // Chunk text with highlighted markers
      const chunkEl = ctxCard.createDiv("jp-discourse-chunk-text");
      this.renderChunkWithMarkers(chunkEl, ctx.cleanText || ctx.chunkText, ctx.markers);

      // Pattern tags
      if (ctx.patternTags.length > 0) {
        const tagsRow = ctxCard.createDiv("jp-discourse-pattern-tags");
        for (const tag of ctx.patternTags) {
          tagsRow.createSpan({ text: tag, cls: "jp-col-chip" });
        }
      }

      // Context before/after (expandable)
      if (ctx.contextBefore || ctx.contextAfter) {
        const ctxDetails = ctxCard.createEl("details", { cls: "jp-discourse-surrounding-ctx" });
        ctxDetails.createEl("summary", { text: "surrounding context" });
        if (ctx.contextBefore) {
          ctxDetails.createEl("p", { text: ctx.contextBefore, cls: "jp-discourse-ctx-before" });
        }
        if (ctx.contextAfter) {
          ctxDetails.createEl("p", { text: ctx.contextAfter, cls: "jp-discourse-ctx-after" });
        }
      }

      // Timestamp
      ctxCard.createDiv({
        text: new Date(ctx.capturedAt).toLocaleString(),
        cls: "jp-discourse-captured-at",
      });
    }
  }

  private renderChunkWithMarkers(
    parent: HTMLElement,
    text: string,
    markers: import("../types.ts").DiscourseMarker[]
  ): void {
    if (markers.length === 0) {
      parent.createSpan({ text });
      return;
    }

    const MARKER_CATEGORY_COLOURS: Record<string, string> = {
      "topic-initiation": "var(--color-blue)",
      "reasoning": "var(--color-orange)",
      "modality": "var(--color-purple)",
      "connective": "var(--color-green)",
      "confirmation": "var(--color-red)",
      "rephrasing": "var(--color-cyan)",
      "filler": "var(--text-muted)",
      "quotation": "var(--color-yellow)",
    };

    // Sort markers by start position
    const sorted = [...markers].sort((a, b) => a.charStart - b.charStart);
    let cursor = 0;

    for (const marker of sorted) {
      if (marker.charStart > cursor) {
        parent.createSpan({ text: text.slice(cursor, marker.charStart) });
      }
      const markerSpan = parent.createSpan({
        text: text.slice(marker.charStart, marker.charEnd),
        cls: "jp-discourse-marker-highlight",
      });
      const colour = MARKER_CATEGORY_COLOURS[marker.category] ?? "var(--text-accent)";
      markerSpan.style.color = colour;
      markerSpan.style.fontWeight = "600";
      markerSpan.setAttribute("title", `${marker.category}: ${marker.surface}`);
      cursor = marker.charEnd;
    }

    if (cursor < text.length) {
      parent.createSpan({ text: text.slice(cursor) });
    }
  }
}
