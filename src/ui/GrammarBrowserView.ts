import type { CollocationEntry, PartOfSpeech } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";

type SortMode = "frequency" | "alpha" | "count";

export class GrammarBrowserView {
  private container: HTMLElement;
  private store: CollocationStore;
  private posFilter: PartOfSpeech[];
  private sortMode: SortMode = "count";

  constructor(parent: HTMLElement, store: CollocationStore, posFilter: PartOfSpeech[]) {
    this.store = store;
    this.posFilter = posFilter;
    this.container = parent.createDiv("jp-col-grammar-browser");
    this.render();
  }

  private render(): void {
    this.container.empty();

    // Sort control
    const toolbar = this.container.createDiv("jp-col-browser-toolbar");
    toolbar.createSpan({ text: "Sort:", cls: "jp-col-browser-label" });

    const sorts: { key: SortMode; label: string }[] = [
      { key: "count", label: "Count" },
      { key: "frequency", label: "Frequency" },
      { key: "alpha", label: "A–Z" },
    ];
    for (const s of sorts) {
      const btn = toolbar.createEl("button", {
        text: s.label,
        cls: "jp-col-sort-btn" + (this.sortMode === s.key ? " jp-col-sort-btn--active" : ""),
      });
      btn.addEventListener("click", () => {
        this.sortMode = s.key;
        this.render();
      });
    }

    // Group entries by pattern
    const all = this.getEntries();
    const grouped = this.groupByPattern(all);
    const patterns = this.sortPatterns(grouped);

    if (patterns.length === 0) {
      this.container.createDiv({ text: "No entries.", cls: "jp-col-empty" });
      return;
    }

    for (const pattern of patterns) {
      const entries = grouped.get(pattern)!;
      this.renderSection(this.container, pattern, entries);
    }
  }

  private getEntries(): CollocationEntry[] {
    const all = this.store.getAll();
    if (this.posFilter.length === 0) return all;
    return all.filter(e => this.posFilter.includes(e.headwordPOS));
  }

  private groupByPattern(entries: CollocationEntry[]): Map<string, CollocationEntry[]> {
    const map = new Map<string, CollocationEntry[]>();
    for (const e of entries) {
      const key = e.pattern || "（未分類）";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }

  private sortPatterns(grouped: Map<string, CollocationEntry[]>): string[] {
    const keys = Array.from(grouped.keys());
    switch (this.sortMode) {
      case "count":
        return keys.sort((a, b) => grouped.get(b)!.length - grouped.get(a)!.length);
      case "frequency":
        return keys.sort((a, b) => {
          const sumFreq = (arr: CollocationEntry[]) => arr.reduce((s, e) => s + (e.frequency ?? 0), 0);
          return sumFreq(grouped.get(b)!) - sumFreq(grouped.get(a)!);
        });
      case "alpha":
        return keys.sort((a, b) => a.localeCompare(b, "ja"));
    }
  }

  private renderSection(parent: HTMLElement, pattern: string, entries: CollocationEntry[]): void {
    const section = parent.createDiv("jp-col-grammar-section");
    const header = section.createDiv("jp-col-grammar-section-header");

    header.createSpan({ text: pattern || "（未分類）", cls: "jp-col-grammar-pattern-label" });
    header.createSpan({ text: `(${entries.length})`, cls: "jp-col-grammar-count" });

    const body = section.createDiv("jp-col-grammar-section-body");
    let collapsed = false;

    header.addEventListener("click", () => {
      collapsed = !collapsed;
      body.toggleClass("jp-col-grammar-section-body--collapsed", collapsed);
      header.toggleClass("jp-col-grammar-section-header--collapsed", collapsed);
    });

    const sorted = [...entries].sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0));
    for (const entry of sorted) {
      this.renderCard(body, entry);
    }
  }

  private renderCard(parent: HTMLElement, entry: CollocationEntry): void {
    const card = parent.createDiv("jp-col-grammar-card");

    const mainRow = card.createDiv("jp-col-card-main");
    mainRow.createSpan({ cls: "jp-col-headword", text: entry.headword });
    mainRow.createSpan({ cls: "jp-col-collocate", text: " " + entry.collocate });
    if (entry.frequency > 0) {
      mainRow.createSpan({ cls: "jp-col-freq-badge", text: `×${entry.frequency}` });
    }

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

  refresh(posFilter: PartOfSpeech[]): void {
    this.posFilter = posFilter;
    this.render();
  }
}
