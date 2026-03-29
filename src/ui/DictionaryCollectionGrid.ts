// ─── Dictionary Collection Grid (辞書棚) ──────────────────────────────────────
// Renders the Monokakido-style coloured tile grid of imported dictionaries,
// grouped by category with section headers.

import type { ImportedDictionary } from "../yomitan/types.ts";
import type { DictionaryMeta } from "../yomitan/types.ts";
import { CATEGORY_ORDER } from "../yomitan/constants.ts";

export type TileClickCallback = (dict: ImportedDictionary) => void;

export class DictionaryCollectionGrid {
  private container: HTMLElement;

  constructor(parent: HTMLElement, private onTileClick: TileClickCallback) {
    this.container = parent.createDiv({ cls: "mkd-shelf" });
  }

  /** Re-render the grid with the current list of imported dictionaries */
  render(dicts: ImportedDictionary[]): void {
    this.container.empty();

    if (dicts.length === 0) {
      const empty = this.container.createDiv({ cls: "mkd-shelf-empty" });
      empty.createDiv({ cls: "mkd-shelf-empty-icon", text: "📖" });
      empty.createDiv({ cls: "mkd-shelf-empty-text", text: "辞書がありません" });
      empty.createDiv({ cls: "mkd-shelf-empty-sub", text: 'Use "Import Yomitan Dictionary" to add dictionaries.' });
      return;
    }

    // Group by category
    const groups = new Map<string, ImportedDictionary[]>();
    for (const cat of CATEGORY_ORDER) {
      groups.set(cat, []);
    }
    for (const dict of dicts) {
      const cat = dict.meta.category;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(dict);
    }

    for (const cat of CATEGORY_ORDER) {
      const items = groups.get(cat);
      if (!items || items.length === 0) continue;

      // Section header
      const section = this.container.createDiv({ cls: "mkd-shelf-section" });
      section.createDiv({ cls: "mkd-shelf-section-header", text: cat });

      const grid = section.createDiv({ cls: "mkd-shelf-grid" });
      for (const dict of items) {
        this.renderTile(grid, dict);
      }
    }
  }

  private renderTile(parent: HTMLElement, dict: ImportedDictionary): void {
    const meta: DictionaryMeta = dict.meta;
    const tile = parent.createDiv({ cls: "mkd-tile" });
    tile.style.setProperty("--mkd-tile-color", meta.color);

    // Coloured badge area
    const badge = tile.createDiv({ cls: "mkd-tile-badge" });

    // For bilingual dicts, show the abbreviation prominently
    const isBilingual = meta.language === "en-ja" || meta.language === "ja-en";
    if (isBilingual) {
      badge.createDiv({ cls: "mkd-tile-abbr", text: meta.abbreviation });
    } else {
      // For monolingual, show first kanji of the title
      const shortLabel = meta.jaTitle.charAt(0);
      badge.createDiv({ cls: "mkd-tile-abbr", text: shortLabel });
    }

    // Title below the badge
    const titleEl = tile.createDiv({ cls: "mkd-tile-title" });
    // For bilingual dicts use English title if available and short
    if (isBilingual && meta.enTitle) {
      titleEl.setText(meta.abbreviation);
      tile.title = `${meta.jaTitle}\n${meta.enTitle}`;
    } else {
      // Truncate long titles
      const displayTitle = meta.jaTitle.length > 12
        ? meta.jaTitle.slice(0, 11) + "…"
        : meta.jaTitle;
      titleEl.setText(displayTitle);
      tile.title = meta.jaTitle;
    }

    // Entry count hint
    tile.createDiv({
      cls: "mkd-tile-count",
      text: dict.termCount > 0 ? `${dict.termCount.toLocaleString()}語` : "",
    });

    tile.addEventListener("click", () => this.onTileClick(dict));
  }

  /** Highlight a specific dictionary tile (e.g. when it has active results) */
  setActiveDict(title: string | null): void {
    this.container.querySelectorAll<HTMLElement>(".mkd-tile").forEach(tile => {
      tile.toggleClass("mkd-tile--active", tile.dataset.dictTitle === title);
    });
  }
}
