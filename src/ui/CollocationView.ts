import { ItemView, WorkspaceLeaf, Menu, Notice } from "obsidian";
import type { App } from "obsidian";
import type { CollocationEntry, PluginSettings, SearchResult, DiscourseCategory } from "../types.ts";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { DiscourseStore } from "../data/DiscourseStore.ts";
import type { SearchEngine } from "../search/SearchEngine.ts";
import { AddEntryModal } from "./AddEntryModal.ts";

export const JP_COLLOCATIONS_VIEW_TYPE = "jp-collocations-view";

const DISCOURSE_CATEGORY_LABELS: Record<string, string> = {
  "topic-initiation": "話題開始",
  "reasoning":        "理由",
  "modality":         "モダリティ",
  "connective":       "接続",
  "confirmation":     "確認",
  "rephrasing":       "言い換え",
  "filler":           "フィラー",
  "quotation":        "引用",
};

const DISCOURSE_CATEGORY_COLOURS: Record<string, string> = {
  "topic-initiation": "#4CAF50",
  "reasoning":        "#2196F3",
  "modality":         "#9C27B0",
  "connective":       "#FF9800",
  "confirmation":     "#00BCD4",
  "rephrasing":       "#795548",
  "filler":           "#607D8B",
  "quotation":        "#E91E63",
};

export class CollocationView extends ItemView {
  private store: CollocationStore;
  private discourseStore: DiscourseStore | null;
  private engine: SearchEngine;
  private settings: PluginSettings;
  private results: SearchResult[] = [];
  private currentPOSFilter: PartOfSpeech[] = [];
  private currentTagFilter: string[] = [];
  private discourseMarkerFilter = "";
  private discourseCategoryFilter = "";
  private searchInput: HTMLInputElement | null = null;
  private discourseMarkerInput: HTMLInputElement | null = null;
  private discourseCategorySelect: HTMLSelectElement | null = null;
  private resultContainer: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    store: CollocationStore,
    engine: SearchEngine,
    settings: PluginSettings,
    discourseStore?: DiscourseStore | null
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

    // Discourse filter row
    if (this.settings.showDiscourseContexts && this.discourseStore) {
      this.buildDiscourseFilterRow(container);
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

  private buildDiscourseFilterRow(container: HTMLElement): void {
    const row = container.createDiv("jp-col-discourse-filter-row");
    row.createEl("span", { text: "談話：", cls: "jp-col-discourse-label" });

    this.discourseMarkerInput = row.createEl("input", {
      type: "text",
      placeholder: "マーカー (e.g. でも)",
      cls: "jp-col-discourse-marker-input",
    });
    this.discourseMarkerInput.addEventListener("input", () => {
      this.discourseMarkerFilter = this.discourseMarkerInput?.value ?? "";
      this.refresh();
    });

    this.discourseCategorySelect = row.createEl("select", { cls: "jp-col-discourse-cat-select" });
    const defaultOpt = this.discourseCategorySelect.createEl("option", { text: "全カテゴリ", value: "" });
    defaultOpt.value = "";
    for (const [cat, label] of Object.entries(DISCOURSE_CATEGORY_LABELS)) {
      const opt = this.discourseCategorySelect.createEl("option", { text: label, value: cat });
      opt.value = cat;
    }
    this.discourseCategorySelect.addEventListener("change", () => {
      this.discourseCategoryFilter = this.discourseCategorySelect?.value ?? "";
      this.refresh();
    });
  }

  refresh(): void {
    const query = this.searchInput?.value ?? "";
    this.results = this.engine.search({
      query,
      posFilter: this.currentPOSFilter.length ? this.currentPOSFilter : undefined,
      tagFilter: this.currentTagFilter.length ? this.currentTagFilter : undefined,
      fuzzy: true,
      maxResults: this.settings.maxResults,
      sortBy: this.settings.defaultSortOrder,
    });

    // Apply discourse filters client-side
    if (this.discourseStore && (this.discourseMarkerFilter || this.discourseCategoryFilter)) {
      let matchingChunkColIds: Set<string> | null = null;

      if (this.discourseMarkerFilter) {
        const chunks = this.discourseStore.getChunksByMarker(this.discourseMarkerFilter);
        const ids = new Set(chunks.flatMap(c => c.collocationIds));
        matchingChunkColIds = ids;
      }

      if (this.discourseCategoryFilter) {
        const chunks = this.discourseStore.getChunksByCategory(this.discourseCategoryFilter);
        const ids = new Set(chunks.flatMap(c => c.collocationIds));
        matchingChunkColIds = matchingChunkColIds
          ? new Set([...matchingChunkColIds].filter(id => ids.has(id)))
          : ids;
      }

      if (matchingChunkColIds) {
        this.results = this.results.filter(r => matchingChunkColIds!.has(r.entry.id));
      }
    }

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
    if (this.settings.showDiscourseContexts && this.discourseStore) {
      const chunks = this.discourseStore.getChunksByCollocation(entry.id);
      if (chunks.length > 0) {
        const discDetails = card.createEl("details", { cls: "jp-col-discourse-details" });
        discDetails.createEl("summary", { text: `談話コンテキスト (${chunks.length})`, cls: "jp-col-discourse-summary" });

        for (const chunk of chunks.slice(0, 5)) {
          const ctxEl = discDetails.createDiv("jp-col-discourse-ctx");
          ctxEl.createEl("p", { text: chunk.context.chunkText, cls: "jp-col-discourse-text" });

          // Color-coded marker chips
          if (chunk.context.markers.length > 0) {
            const markersEl = ctxEl.createDiv("jp-col-discourse-markers");
            for (const marker of chunk.context.markers) {
              const chip = markersEl.createEl("span", {
                text: marker.surface,
                cls: "jp-col-discourse-marker-chip",
              });
              chip.style.background = DISCOURSE_CATEGORY_COLOURS[marker.category] ?? "#888";
              chip.title = DISCOURSE_CATEGORY_LABELS[marker.category] ?? marker.category;
            }
          }

          // Source info
          if (chunk.context.source.file) {
            ctxEl.createEl("span", {
              text: `📄 ${chunk.context.source.file}`,
              cls: "jp-col-discourse-source",
            });
          }
        }

        if (chunks.length > 5) {
          discDetails.createEl("p", {
            text: `… and ${chunks.length - 5} more`,
            cls: "jp-col-discourse-more",
          });
        }
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
}
