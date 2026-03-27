import type { CollocationEntry, PartOfSpeech } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";

export class ConnectionMapView {
  private container: HTMLElement;
  private store: CollocationStore;
  private posFilter: PartOfSpeech[];
  private selectedHeadword: string = "";
  private searchInput: HTMLInputElement | null = null;
  private mapContainer: HTMLElement | null = null;

  constructor(parent: HTMLElement, store: CollocationStore, posFilter: PartOfSpeech[]) {
    this.store = store;
    this.posFilter = posFilter;
    this.container = parent.createDiv("jp-col-connection-map");
    this.build();
  }

  private build(): void {
    this.container.empty();

    // Headword search row
    const searchRow = this.container.createDiv("jp-col-conn-search-row");
    searchRow.createSpan({ text: "語 :", cls: "jp-col-browser-label" });
    this.searchInput = searchRow.createEl("input", {
      type: "text",
      placeholder: "Enter headword…",
      cls: "jp-col-conn-input",
    });

    const headwords = this.getHeadwords();
    // Datalist for autocomplete
    const dlId = "jp-col-conn-dl";
    const dl = this.container.createEl("datalist");
    dl.id = dlId;
    for (const hw of headwords) {
      const opt = dl.createEl("option");
      opt.value = hw;
    }
    this.searchInput.setAttribute("list", dlId);

    this.searchInput.addEventListener("input", () => {
      this.selectedHeadword = this.searchInput?.value.trim() ?? "";
      this.renderMap();
    });

    this.mapContainer = this.container.createDiv("jp-col-conn-map-body");
    this.renderMap();
  }

  private getHeadwords(): string[] {
    const all = this.store.getAll();
    const set = new Set<string>();
    for (const e of all) set.add(e.headword);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
  }

  private renderMap(): void {
    if (!this.mapContainer) return;
    this.mapContainer.empty();

    if (!this.selectedHeadword) {
      this.mapContainer.createDiv({ text: "Type a headword to see its connections.", cls: "jp-col-empty" });
      return;
    }

    let entries = this.store.getByHeadword(this.selectedHeadword);
    if (this.posFilter.length > 0) {
      entries = entries.filter(e => this.posFilter.includes(e.headwordPOS));
    }

    if (entries.length === 0) {
      this.mapContainer.createDiv({ text: `No entries for "${this.selectedHeadword}".`, cls: "jp-col-empty" });
      return;
    }

    // Root label
    const root = this.mapContainer.createDiv("jp-col-conn-root");
    root.createSpan({ text: this.selectedHeadword, cls: "jp-col-conn-root-label" });

    // Group by pattern
    const byPattern = this.groupByPattern(entries);
    const patterns = Array.from(byPattern.keys()).sort();

    for (let pi = 0; pi < patterns.length; pi++) {
      const pattern = patterns[pi];
      const group = byPattern.get(pattern)!;
      const isLast = pi === patterns.length - 1;

      const branchRow = this.mapContainer.createDiv("jp-col-conn-branch");
      const connector = branchRow.createSpan({ cls: "jp-col-conn-connector", text: isLast ? "└─" : "├─" });
      connector.setAttribute("aria-hidden", "true");
      branchRow.createSpan({ cls: "jp-col-conn-pattern-label", text: pattern || "（未分類）" });
      branchRow.createSpan({ cls: "jp-col-conn-sep", text: ":" });

      const collocateList = branchRow.createSpan({ cls: "jp-col-conn-collocate-list" });
      const collocateTexts = group.map(e => e.collocate).join(", ");
      branchRow.createSpan({ cls: "jp-col-conn-count", text: ` (${group.length})` });

      // Expandable details for each collocate
      const details = this.mapContainer.createEl("details", { cls: "jp-col-conn-details" });
      const summaryEl = details.createEl("summary", { cls: "jp-col-conn-summary" });

      // Show collocates inline in branch row and in summary
      collocateList.textContent = collocateTexts;
      summaryEl.textContent = `${pattern || "（未分類）"} (${group.length})`;

      for (const entry of group) {
        const item = details.createDiv("jp-col-conn-entry");
        const phraseRow = item.createDiv("jp-col-conn-phrase-row");
        phraseRow.createSpan({ cls: "jp-col-conn-arrow", text: "→" });
        phraseRow.createSpan({ cls: "jp-col-collocate", text: entry.collocate });
        if (entry.frequency > 0) {
          phraseRow.createSpan({ cls: "jp-col-freq-badge", text: `×${entry.frequency}` });
        }
        if (entry.exampleSentences.length > 0 || entry.notes) {
          for (const s of entry.exampleSentences) {
            item.createEl("p", { text: s, cls: "jp-col-example" });
          }
          if (entry.notes) {
            item.createEl("p", { text: entry.notes, cls: "jp-col-notes" });
          }
        }
      }
    }
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

  refresh(posFilter: PartOfSpeech[]): void {
    this.posFilter = posFilter;
    this.renderMap();
  }
}
