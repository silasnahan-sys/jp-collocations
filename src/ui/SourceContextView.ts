import type { CollocationEntry, PartOfSpeech } from "../types.ts";
import { CollocationSource } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";

const SOURCE_LABELS: Record<string, string> = {
  [CollocationSource.Manual]: "手動追加 (manual)",
  [CollocationSource.Hyogen]: "表現 (hyogen.info)",
  [CollocationSource.Classified]: "自動分類 (classified)",
  [CollocationSource.Import]: "インポート (import)",
};

/** Highlight occurrences of the collocation phrase within the sentence. */
function highlightCollocation(sentence: string, fullPhrase: string, parent: HTMLElement): void {
  if (!fullPhrase || !sentence.includes(fullPhrase)) {
    parent.createSpan({ text: sentence });
    return;
  }
  const idx = sentence.indexOf(fullPhrase);
  if (idx > 0) parent.createSpan({ text: sentence.slice(0, idx) });
  parent.createEl("strong", { text: fullPhrase, cls: "jp-col-highlight" });
  if (idx + fullPhrase.length < sentence.length) {
    parent.createSpan({ text: sentence.slice(idx + fullPhrase.length) });
  }
}

export class SourceContextView {
  private container: HTMLElement;
  private store: CollocationStore;
  private posFilter: PartOfSpeech[];

  constructor(parent: HTMLElement, store: CollocationStore, posFilter: PartOfSpeech[]) {
    this.store = store;
    this.posFilter = posFilter;
    this.container = parent.createDiv("jp-col-source-context");
    this.render();
  }

  private render(): void {
    this.container.empty();

    const all = this.getEntries();
    if (all.length === 0) {
      this.container.createDiv({ text: "No entries.", cls: "jp-col-empty" });
      return;
    }

    const grouped = this.groupBySource(all);
    const sources = Array.from(grouped.keys()).sort();

    for (const source of sources) {
      const entries = grouped.get(source)!;
      this.renderSourceSection(source, entries);
    }
  }

  private getEntries(): CollocationEntry[] {
    const all = this.store.getAll();
    if (this.posFilter.length === 0) return all;
    return all.filter(e => this.posFilter.includes(e.headwordPOS));
  }

  private groupBySource(entries: CollocationEntry[]): Map<string, CollocationEntry[]> {
    const map = new Map<string, CollocationEntry[]>();
    for (const e of entries) {
      const key = e.source;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }

  private renderSourceSection(source: string, entries: CollocationEntry[]): void {
    const section = this.container.createDiv("jp-col-source-section");
    const header = section.createDiv("jp-col-source-section-header");
    header.createSpan({ text: SOURCE_LABELS[source] ?? source, cls: "jp-col-source-label" });
    header.createSpan({ text: `(${entries.length})`, cls: "jp-col-grammar-count" });

    const body = section.createDiv("jp-col-source-section-body");
    let collapsed = false;

    header.addEventListener("click", () => {
      collapsed = !collapsed;
      body.toggleClass("jp-col-source-section-body--collapsed", collapsed);
      header.toggleClass("jp-col-source-section-header--collapsed", collapsed);
    });

    const sorted = [...entries].sort((a, b) => a.headword.localeCompare(b.headword, "ja"));

    for (const entry of sorted) {
      this.renderEntry(body, entry);
    }
  }

  private renderEntry(parent: HTMLElement, entry: CollocationEntry): void {
    const card = parent.createDiv("jp-col-source-card");

    const mainRow = card.createDiv("jp-col-card-main");
    mainRow.createSpan({ cls: "jp-col-headword", text: entry.headword });
    mainRow.createSpan({ cls: "jp-col-collocate", text: " " + entry.collocate });
    if (entry.pattern) {
      mainRow.createSpan({ cls: "jp-col-pattern", text: entry.pattern });
    }

    // Embedded example sentences with collocation bolded
    if (entry.exampleSentences.length > 0) {
      const quotesEl = card.createDiv("jp-col-source-quotes");
      for (const sentence of entry.exampleSentences) {
        const quote = quotesEl.createEl("blockquote", { cls: "jp-col-source-quote" });
        highlightCollocation(sentence, entry.fullPhrase, quote);
      }
    }

    if (entry.notes) {
      card.createEl("p", { text: entry.notes, cls: "jp-col-notes" });
    }
  }

  refresh(posFilter: PartOfSpeech[]): void {
    this.posFilter = posFilter;
    this.render();
  }
}
