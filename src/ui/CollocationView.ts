import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { CollocationEntry, PluginSettings, SearchResult } from "../types.ts";
import {
  PartOfSpeech,
  Register,
  JLPTLevel,
  BoundaryType,
  CollocationStrength,
} from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { SearchEngine } from "../search/SearchEngine.ts";
import { AddEntryModal } from "./AddEntryModal.ts";

export const JP_COLLOCATIONS_VIEW_TYPE = "jp-collocations-view";

const STRENGTH_PCT: Record<CollocationStrength, number> = {
  [CollocationStrength.Weak]: 25,
  [CollocationStrength.Moderate]: 50,
  [CollocationStrength.Strong]: 75,
  [CollocationStrength.Fixed]: 100,
};

export class CollocationView extends ItemView {
  private store: CollocationStore;
  private engine: SearchEngine;
  private settings: PluginSettings;
  private results: SearchResult[] = [];
  private currentPOSFilter: PartOfSpeech[] = [];
  private currentTagFilter: string[] = [];
  private currentRegisterFilter: Register[] = [];
  private currentJLPTFilter: JLPTLevel[] = [];
  private currentStrengthFilter: CollocationStrength[] = [];
  private currentBoundaryFilter: BoundaryType[] = [];
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

  getViewType(): string { return JP_COLLOCATIONS_VIEW_TYPE; }
  getDisplayText(): string { return "JP Collocations"; }
  getIcon(): string { return "languages"; }

  async onOpen(): Promise<void> {
    this.buildUI();
    this.refresh();
  }

  async onClose(): Promise<void> {}

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

    // Register filter chips
    const regRow = container.createDiv("jp-col-filter-row");
    this.buildRegisterChips(regRow);

    // JLPT filter chips
    const jlptRow = container.createDiv("jp-col-filter-row");
    this.buildJLPTChips(jlptRow);

    // Strength filter chips
    const strRow = container.createDiv("jp-col-filter-row");
    this.buildStrengthChips(strRow);

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
      parent.querySelectorAll(".jp-col-chip--active").forEach(el => el.removeClass("jp-col-chip--active"));
      this.refresh();
    });
  }

  private buildRegisterChips(parent: HTMLElement): void {
    const label = parent.createEl("span", { text: "Register: ", cls: "jp-col-filter-label" });
    for (const reg of Object.values(Register)) {
      const chip = parent.createEl("span", {
        text: reg,
        cls: `jp-col-chip jp-coll-register-${reg}`,
      });
      chip.addEventListener("click", () => {
        if (this.currentRegisterFilter.includes(reg)) {
          this.currentRegisterFilter = this.currentRegisterFilter.filter(r => r !== reg);
          chip.removeClass("jp-col-chip--active");
        } else {
          this.currentRegisterFilter.push(reg);
          chip.addClass("jp-col-chip--active");
        }
        this.refresh();
      });
    }
  }

  private buildJLPTChips(parent: HTMLElement): void {
    parent.createEl("span", { text: "JLPT: ", cls: "jp-col-filter-label" });
    for (const lvl of Object.values(JLPTLevel)) {
      const chip = parent.createEl("span", {
        text: lvl,
        cls: `jp-col-chip jp-coll-jlpt-${lvl.toLowerCase()}`,
      });
      chip.addEventListener("click", () => {
        if (this.currentJLPTFilter.includes(lvl)) {
          this.currentJLPTFilter = this.currentJLPTFilter.filter(l => l !== lvl);
          chip.removeClass("jp-col-chip--active");
        } else {
          this.currentJLPTFilter.push(lvl);
          chip.addClass("jp-col-chip--active");
        }
        this.refresh();
      });
    }
  }

  private buildStrengthChips(parent: HTMLElement): void {
    parent.createEl("span", { text: "Strength: ", cls: "jp-col-filter-label" });
    for (const str of Object.values(CollocationStrength)) {
      const chip = parent.createEl("span", { text: str, cls: "jp-col-chip" });
      chip.addEventListener("click", () => {
        if (this.currentStrengthFilter.includes(str)) {
          this.currentStrengthFilter = this.currentStrengthFilter.filter(s => s !== str);
          chip.removeClass("jp-col-chip--active");
        } else {
          this.currentStrengthFilter.push(str);
          chip.addClass("jp-col-chip--active");
        }
        this.refresh();
      });
    }
  }

  refresh(): void {
    const query = this.searchInput?.value ?? "";
    this.results = this.engine.search({
      query,
      posFilter: this.currentPOSFilter.length ? this.currentPOSFilter : undefined,
      tagFilter: this.currentTagFilter.length ? this.currentTagFilter : undefined,
      registerFilter: this.currentRegisterFilter.length ? this.currentRegisterFilter : undefined,
      jlptFilter: this.currentJLPTFilter.length ? this.currentJLPTFilter : undefined,
      strengthFilter: this.currentStrengthFilter.length ? this.currentStrengthFilter : undefined,
      boundaryTypeFilter: this.currentBoundaryFilter.length ? this.currentBoundaryFilter : undefined,
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
    this.statsEl.createSpan({
      text: `${this.results.length} / ${stats.total} entries`,
      cls: "jp-col-stat-text",
    });
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

    // Headword + reading
    mainRow.createSpan({ cls: "jp-col-headword", text: entry.headword });
    if (this.settings.showReadings && entry.headwordReading) {
      mainRow.createSpan({ cls: "jp-col-reading", text: `（${entry.headwordReading}）` });
    }
    mainRow.createSpan({ cls: "jp-col-collocate", text: " " + entry.collocate });

    // POS badge
    mainRow.createSpan({
      cls: `jp-col-pos jp-col-pos--${this.posClass(entry.headwordPOS)}`,
      text: entry.headwordPOS,
    });

    // Pattern
    if (entry.pattern) {
      mainRow.createSpan({ cls: "jp-col-pattern", text: entry.pattern });
    }

    // Badge row
    const badgeRow = card.createDiv("jp-col-badge-row");

    if (this.settings.showRegisterBadges && entry.register) {
      badgeRow.createSpan({
        cls: `jp-col-badge jp-coll-register-${entry.register}`,
        text: entry.register,
      });
    }

    if (this.settings.showJLPTBadges && entry.jlptLevel) {
      badgeRow.createSpan({
        cls: `jp-col-badge jp-coll-jlpt-${entry.jlptLevel.toLowerCase()}`,
        text: entry.jlptLevel,
      });
    }

    if (entry.boundaryType) {
      badgeRow.createSpan({ cls: "jp-col-badge jp-col-boundary", text: entry.boundaryType });
    }

    // Strength meter
    if (this.settings.showStrengthMeter && entry.strength) {
      const meterWrap = card.createDiv("jp-coll-strength-wrap");
      meterWrap.createSpan({ cls: "jp-coll-strength-label", text: entry.strength });
      const bar = meterWrap.createDiv("jp-coll-strength-bar");
      const fill = bar.createDiv("jp-coll-strength-fill");
      fill.style.width = `${STRENGTH_PCT[entry.strength] ?? 50}%`;
    }

    // Actions
    const actRow = card.createDiv("jp-col-actions");
    this.buildActions(actRow, entry);

    // Expandable details
    const hasDetails =
      entry.exampleSentences.length > 0 ||
      entry.notes ||
      (this.settings.showNegativeExamples && entry.negativeExamples && entry.negativeExamples.length > 0) ||
      entry.literalMeaning ||
      entry.figurativeMeaning ||
      (entry.relatedEntries && entry.relatedEntries.length > 0);

    if (hasDetails) {
      const details = card.createEl("details", { cls: "jp-col-details" });
      details.createEl("summary", { text: "examples / details" });

      for (const s of entry.exampleSentences) {
        details.createEl("p", { text: s, cls: "jp-col-example" });
      }

      if (this.settings.showNegativeExamples && entry.negativeExamples && entry.negativeExamples.length > 0) {
        const negBox = details.createDiv("jp-coll-negative");
        negBox.createEl("strong", { text: "✗ Don't say: " });
        for (const neg of entry.negativeExamples) {
          negBox.createEl("p", { text: neg, cls: "jp-coll-negative-example" });
        }
      }

      if (entry.literalMeaning) {
        details.createEl("p", { cls: "jp-col-meaning", text: `Literal: ${entry.literalMeaning}` });
      }
      if (entry.figurativeMeaning) {
        details.createEl("p", { cls: "jp-col-meaning", text: `Figurative: ${entry.figurativeMeaning}` });
      }
      if (entry.typicalContext) {
        details.createEl("p", { cls: "jp-col-meaning", text: `Context: ${entry.typicalContext}` });
      }

      if (entry.notes) {
        details.createEl("p", { text: entry.notes, cls: "jp-col-notes" });
      }

      // Related entries "see also"
      if (entry.relatedEntries && entry.relatedEntries.length > 0) {
        const seeAlso = details.createDiv("jp-col-see-also");
        seeAlso.createEl("strong", { text: "See also: " });
        for (const relId of entry.relatedEntries) {
          const rel = this.store.getById(relId);
          if (!rel) continue;
          const link = seeAlso.createEl("span", {
            cls: "jp-col-see-also-link",
            text: rel.fullPhrase,
          });
          link.addEventListener("click", () => {
            if (this.searchInput) {
              this.searchInput.value = rel.headword;
              this.refresh();
            }
          });
        }
      }

      // MI score if present
      if (entry.miScore !== undefined) {
        details.createEl("p", {
          cls: "jp-col-score",
          text: `MI: ${entry.miScore.toFixed(2)}${entry.tScore !== undefined ? `  t: ${entry.tScore.toFixed(2)}` : ""}`,
        });
      }
    }
  }

  private buildActions(parent: HTMLElement, entry: CollocationEntry): void {
    const copyBtn = parent.createEl("button", { text: "Copy", cls: "jp-col-action-btn" });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(entry.fullPhrase).then(() => {
        new Notice(`Copied: ${entry.fullPhrase}`);
      }).catch(() => { new Notice("Copy failed."); });
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
