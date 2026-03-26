import { ItemView, WorkspaceLeaf, Menu, Notice } from "obsidian";
import type { App } from "obsidian";
import type { CollocationEntry, PluginSettings, SearchResult } from "../types.ts";
import { PartOfSpeech, CollocationSource } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { SearchEngine } from "../search/SearchEngine.ts";
import { AddEntryModal } from "./AddEntryModal.ts";

export const JP_COLLOCATIONS_VIEW_TYPE = "jp-collocations-view";

export class CollocationView extends ItemView {
  private store: CollocationStore;
  private engine: SearchEngine;
  private settings: PluginSettings;
  private results: SearchResult[] = [];
  private currentPOSFilter: PartOfSpeech[] = [];
  private currentTagFilter: string[] = [];
  private searchInput: HTMLInputElement | null = null;
  private resultContainer: HTMLElement | null = null;
  private statsEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    store: CollocationStore,
    engine: SearchEngine,
    settings: PluginSettings
  ) {
    super(leaf);
    this.store = store;
    this.engine = engine;
    this.settings = settings;
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
