import type { CollocationEntry, PartOfSpeech } from "../types.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";

/**
 * Attempts to extract the base (dictionary) form of a word appearing in a collocation headword.
 * Strips common conjugation suffixes to find the canonical form.
 */
function extractBaseForm(word: string): string {
  if (!word) return word;

  // Strip common inflectional endings to reach the stem, then try to reconstruct dict form.
  const inflectionMap: [RegExp, string][] = [
    [/ませんでした$/, "ます"],
    [/ました$/, "ます"],
    [/ません$/, "ます"],
    [/して$/, "する"],
    [/した$/, "する"],
    [/しない$/, "する"],
    [/すれば$/, "する"],
    [/しよう$/, "する"],
    [/って$/, "う"],    // godan -u
    [/った$/, "う"],
    [/わない$/, "う"],
    [/えば$/, "う"],
    [/いて$/, "く"],    // godan -ku
    [/いた$/, "く"],
    [/かない$/, "く"],
    [/けば$/, "く"],
    [/いで$/, "ぐ"],    // godan -gu
    [/いだ$/, "ぐ"],
    [/がない$/, "ぐ"],
    [/げば$/, "ぐ"],
    [/して$/, "す"],    // godan -su
    [/した$/, "す"],
    [/さない$/, "す"],
    [/せば$/, "す"],
    [/って$/, "つ"],    // godan -tsu
    [/った$/, "つ"],
    [/たない$/, "つ"],
    [/てば$/, "つ"],
    [/んで$/, "ぶ"],    // godan -bu / -mu / -nu
    [/んだ$/, "ぶ"],
    [/ばない$/, "ぶ"],
    [/べば$/, "ぶ"],
    [/んで$/, "む"],
    [/んだ$/, "む"],
    [/まない$/, "む"],
    [/めば$/, "む"],
    [/って$/, "る"],    // godan -ru
    [/った$/, "る"],
    [/らない$/, "る"],
    [/れば$/, "る"],
    // ichidan
    [/て$/, "る"],
    [/た$/, "る"],
    [/ない$/, "る"],
    [/ます$/, "る"],
    [/れる$/, "る"],
    [/られる$/, "る"],
    [/よう$/, "る"],
    // い-adjective
    [/くて$/, "い"],
    [/くない$/, "い"],
    [/かった$/, "い"],
    [/くなかった$/, "い"],
    [/ければ$/, "い"],
    [/く$/, "い"],
  ];

  for (const [pattern, suffix] of inflectionMap) {
    if (pattern.test(word)) {
      const stem = word.replace(pattern, "");
      if (stem.length > 0) return stem + suffix;
    }
  }

  return word;
}

/** Group collocations by the base form of their headword. */
function groupByBaseForm(entries: CollocationEntry[]): Map<string, CollocationEntry[]> {
  const map = new Map<string, CollocationEntry[]>();
  for (const e of entries) {
    const base = extractBaseForm(e.headword);
    if (!map.has(base)) map.set(base, []);
    map.get(base)!.push(e);
  }
  return map;
}

export class FormVariationsView {
  private container: HTMLElement;
  private store: CollocationStore;
  private posFilter: PartOfSpeech[];

  constructor(parent: HTMLElement, store: CollocationStore, posFilter: PartOfSpeech[]) {
    this.store = store;
    this.posFilter = posFilter;
    this.container = parent.createDiv("jp-col-form-variations");
    this.render();
  }

  private render(): void {
    this.container.empty();

    const all = this.getEntries();
    if (all.length === 0) {
      this.container.createDiv({ text: "No entries.", cls: "jp-col-empty" });
      return;
    }

    const grouped = groupByBaseForm(all);

    // Only show groups that actually have more than one form variation (or groups with any entries)
    const sortedBases = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b, "ja"));

    for (const base of sortedBases) {
      const entries = grouped.get(base)!;
      // Skip if only one variant and it equals the base (no interesting variations)
      const hasVariation = entries.some(e => e.headword !== base) || entries.length > 1;
      if (!hasVariation && entries.length <= 1) continue;
      this.renderGroup(base, entries);
    }
  }

  private getEntries(): CollocationEntry[] {
    const all = this.store.getAll();
    if (this.posFilter.length === 0) return all;
    return all.filter(e => this.posFilter.includes(e.headwordPOS));
  }

  private renderGroup(base: string, entries: CollocationEntry[]): void {
    const section = this.container.createDiv("jp-col-forms-section");
    const header = section.createDiv("jp-col-forms-section-header");
    header.createSpan({ text: base, cls: "jp-col-forms-base-label" });
    header.createSpan({ text: `(${entries.length})`, cls: "jp-col-grammar-count" });

    const body = section.createDiv("jp-col-forms-section-body");
    let collapsed = false;

    header.addEventListener("click", () => {
      collapsed = !collapsed;
      body.toggleClass("jp-col-forms-section-body--collapsed", collapsed);
      header.toggleClass("jp-col-forms-section-header--collapsed", collapsed);
    });

    // Sort entries: base form first, then alphabetically by headword
    const sorted = [...entries].sort((a, b) => {
      if (a.headword === base) return -1;
      if (b.headword === base) return 1;
      return a.headword.localeCompare(b.headword, "ja");
    });

    for (const entry of sorted) {
      this.renderVariationRow(body, entry, base);
    }
  }

  private renderVariationRow(parent: HTMLElement, entry: CollocationEntry, base: string): void {
    const row = parent.createDiv("jp-col-forms-row");

    const formLabel = row.createDiv("jp-col-forms-form-label");
    formLabel.createSpan({
      text: entry.headword,
      cls: entry.headword === base ? "jp-col-forms-base-form" : "jp-col-forms-variant-form",
    });

    const phraseEl = row.createDiv("jp-col-forms-phrase");
    phraseEl.createSpan({ cls: "jp-col-collocate", text: entry.collocate });

    if (entry.exampleSentences.length > 0 || entry.notes) {
      const details = row.createEl("details", { cls: "jp-col-details" });
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
