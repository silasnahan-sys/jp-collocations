import type { ContextEntry, ContextChunk, DiscourseBit, DiscourseRelation } from "../types.ts";
import { CATEGORY_COLOURS } from "../types.ts";
import type { ContextStore } from "../data/ContextStore.ts";

/** Fallback colour for bits without a category. */
function colourForBit(bit: DiscourseBit): string {
  if (bit.category && CATEGORY_COLOURS[bit.category]) {
    return CATEGORY_COLOURS[bit.category];
  }
  return "#888";
}

/**
 * ContextLexiconView — a browsable, deeply indexable view of all context entries.
 *
 * Unlike the DiscourseCardView (which uses spoiler / reveal UX for card study),
 * this view shows everything visibly so you can browse, compare, and capture
 * variations and different perspectives across the corpus.
 *
 * Features:
 * - Filter by discourse category or function
 * - Search bits by text
 * - Discourse function frequency distribution
 * - Visible colour-coded connections between bits
 */
export class ContextLexiconView {
  private container: HTMLElement;
  private contextStore: ContextStore;
  private filterTag: string | null = null;
  private filterCategory: string | null = null;
  private filterFunction: string | null = null;
  private searchQuery = "";

  constructor(parent: HTMLElement, contextStore: ContextStore) {
    this.contextStore = contextStore;
    this.container = parent.createDiv("jp-col-ctx-lexicon-view");
    this.render();
  }

  private render(): void {
    this.container.empty();

    const entries = this.contextStore.getAllEntries();
    const chunks = this.contextStore.getAllChunks();

    if (entries.length === 0) {
      this.container.createDiv({
        text: "No context entries yet. Index a phrase from the vault to see entries here.",
        cls: "jp-col-empty",
      });
      return;
    }

    // Toolbar
    const storeSize = this.contextStore.size();
    const toolbar = this.container.createDiv("jp-col-browser-toolbar");
    toolbar.createSpan({
      text: `${entries.length} entries · ${chunks.length} chunks · ${storeSize.bits} bits`,
      cls: "jp-col-browser-label",
    });

    // Search input for bit text search
    const searchRow = this.container.createDiv("jp-col-ctx-search-row");
    const searchInput = searchRow.createEl("input", {
      type: "text",
      placeholder: "Search bits by text…",
      cls: "jp-col-search-input",
      value: this.searchQuery,
    });
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.render();
    });

    // Category filter chips
    const categories = this.contextStore.getAllCategories();
    if (categories.length > 0) {
      const catRow = this.container.createDiv("jp-col-filter-row");
      catRow.createSpan({ text: "Categories:", cls: "jp-col-browser-label" });
      for (const cat of categories) {
        const colour = CATEGORY_COLOURS[cat as keyof typeof CATEGORY_COLOURS] ?? "#888";
        const chip = catRow.createEl("span", {
          text: cat,
          cls: "jp-col-chip" + (this.filterCategory === cat ? " jp-col-chip--active" : ""),
        });
        chip.style.setProperty("border-color", colour);
        if (this.filterCategory === cat) {
          chip.style.setProperty("background", colour);
          chip.style.setProperty("color", "#fff");
        } else {
          chip.style.setProperty("color", colour);
        }
        chip.addEventListener("click", () => {
          this.filterCategory = this.filterCategory === cat ? null : cat;
          this.filterFunction = null;
          this.render();
        });
      }
    }

    // Function filter chips (only when a category is selected)
    if (this.filterCategory) {
      const allFns = this.contextStore.getAllFunctions();
      // Filter to functions that belong to the selected category
      const catFns = allFns.filter(fn => {
        const bits = this.contextStore.getBitsByFunction(fn);
        return bits.some(b => b.category === this.filterCategory);
      });
      if (catFns.length > 0) {
        const fnRow = this.container.createDiv("jp-col-filter-row");
        fnRow.createSpan({ text: "Functions:", cls: "jp-col-browser-label" });
        for (const fn of catFns) {
          const chip = fnRow.createEl("span", {
            text: fn,
            cls: "jp-col-chip" + (this.filterFunction === fn ? " jp-col-chip--active" : ""),
          });
          chip.addEventListener("click", () => {
            this.filterFunction = this.filterFunction === fn ? null : fn;
            this.render();
          });
        }
      }
    }

    // Tag filter chips
    const allTags = this.collectTags(entries);
    if (allTags.length > 0) {
      const tagRow = this.container.createDiv("jp-col-filter-row");
      tagRow.createSpan({ text: "Tags:", cls: "jp-col-browser-label" });
      for (const tag of allTags) {
        const chip = tagRow.createEl("span", {
          text: tag,
          cls: "jp-col-chip" + (this.filterTag === tag ? " jp-col-chip--active" : ""),
        });
        chip.addEventListener("click", () => {
          this.filterTag = this.filterTag === tag ? null : tag;
          this.render();
        });
      }
      const clearBtn = tagRow.createEl("span", { text: "✕ clear all", cls: "jp-col-chip jp-col-chip--clear" });
      clearBtn.addEventListener("click", () => {
        this.filterTag = null;
        this.filterCategory = null;
        this.filterFunction = null;
        this.searchQuery = "";
        this.render();
      });
    }

    // Function distribution stats
    this.renderFunctionDistribution(this.container);

    // Group entries by chunk
    const grouped = this.groupByChunk(entries, chunks);

    const list = this.container.createDiv("jp-col-ctx-list");
    for (const group of grouped) {
      if (!this.chunkPassesFilter(group.chunk, group.entries)) continue;
      this.renderChunkGroup(list, group.chunk, group.entries);
    }
  }

  /** Check if a chunk/entries group passes all active filters. */
  private chunkPassesFilter(chunk: ContextChunk, entries: ContextEntry[]): boolean {
    // Tag filter
    if (this.filterTag) {
      if (!entries.some(e => e.tags.includes(this.filterTag!))) return false;
    }

    // Category filter
    if (this.filterCategory) {
      if (!chunk.bits.some(b => b.category === this.filterCategory)) return false;
    }

    // Function filter
    if (this.filterFunction) {
      if (!chunk.bits.some(b => b.functions.includes(this.filterFunction as never))) return false;
    }

    // Text search
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.trim().toLowerCase();
      if (!chunk.bits.some(b => b.text.toLowerCase().includes(q))) return false;
    }

    return true;
  }

  /**
   * Render a horizontal bar-chart of discourse function distribution.
   */
  private renderFunctionDistribution(parent: HTMLElement): void {
    const fnDist = this.contextStore.getFunctionDistribution();
    const fnEntries = Object.entries(fnDist);
    if (fnEntries.length === 0) return;

    const total = fnEntries.reduce((s, [, n]) => s + n, 0);

    const section = parent.createEl("details", { cls: "jp-col-ctx-stats-section" });
    section.createEl("summary", {
      text: `Discourse function index (${fnEntries.length} functions, ${total} bits)`,
      cls: "jp-col-ctx-stats-summary",
    });

    const table = section.createDiv("jp-col-ctx-stats-table");
    for (const [fn, count] of fnEntries.sort((a, b) => b[1] - a[1])) {
      const pct = Math.round((count / total) * 100);
      const row = table.createDiv("jp-col-discourse-stats-row");

      const fnBits = this.contextStore.getBitsByFunction(fn);
      const cat = fnBits.length > 0 ? fnBits[0].category : null;
      const colour = cat && CATEGORY_COLOURS[cat] ? CATEGORY_COLOURS[cat] : "#888";

      const label = row.createSpan({ text: fn, cls: "jp-col-discourse-stats-cat" });
      label.style.setProperty("color", colour);

      const barOuter = row.createDiv("jp-col-discourse-stats-bar-outer");
      const barInner = barOuter.createDiv("jp-col-discourse-stats-bar-inner");
      barInner.style.setProperty("width", `${Math.max(pct, 4)}%`);
      barInner.style.setProperty("background", colour);

      row.createSpan({ text: `${count}`, cls: "jp-col-discourse-stats-count" });
    }
  }

  private renderChunkGroup(parent: HTMLElement, chunk: ContextChunk, entries: ContextEntry[]): void {
    const section = parent.createDiv("jp-col-ctx-section");

    // Section header (collapsible)
    const header = section.createDiv("jp-col-ctx-section-header");
    const labelEl = header.createSpan({ cls: "jp-col-ctx-label" });
    labelEl.createEl("strong", { text: chunk.selectedPhrase });
    labelEl.createSpan({ text: ` — ${chunk.sourceFile}`, cls: "jp-col-ctx-source" });

    header.createSpan({
      text: `${chunk.bits.length} bits · ${entries.length} entries`,
      cls: "jp-col-grammar-count",
    });

    const body = section.createDiv("jp-col-ctx-section-body");

    let collapsed = false;
    header.addEventListener("click", () => {
      collapsed = !collapsed;
      body.toggleClass("jp-col-ctx-section-body--collapsed", collapsed);
      header.toggleClass("jp-col-ctx-section-header--collapsed", collapsed);
    });

    // Render the full chunk with visible bit connections
    this.renderVisibleChunk(body, chunk);

    // Render individual entries
    for (const entry of entries) {
      if (this.filterTag && !entry.tags.includes(this.filterTag)) continue;
      this.renderEntry(body, entry, chunk);
    }
  }

  /**
   * Render the full chunk with all bits visible (no spoilers)
   * and per-category colour-coded connection indicators.
   */
  private renderVisibleChunk(parent: HTMLElement, chunk: ContextChunk): void {
    const chunkEl = parent.createDiv("jp-col-ctx-chunk");

    let currentSpeaker = "";
    for (const bit of chunk.bits) {
      if (bit.speaker !== currentSpeaker) {
        currentSpeaker = bit.speaker;
        chunkEl.createDiv({
          text: currentSpeaker,
          cls: "jp-col-ctx-speaker",
        });
      }

      const colour = colourForBit(bit);

      // Dim bits that don't match the active function/category filter
      const dimmed =
        (this.filterCategory && bit.category !== this.filterCategory) ||
        (this.filterFunction && !bit.functions.includes(this.filterFunction as never));

      const bitEl = chunkEl.createDiv("jp-col-ctx-bit");
      bitEl.style.setProperty("--connection-color", colour);
      if (dimmed) bitEl.style.setProperty("opacity", "0.35");

      // Highlight search matches
      const matchesSearch = this.searchQuery.trim() &&
        bit.text.toLowerCase().includes(this.searchQuery.trim().toLowerCase());

      // Colour-coded left border
      bitEl.createDiv("jp-col-ctx-bit-indicator");

      const textEl = bitEl.createSpan({
        text: bit.text,
        cls: "jp-col-ctx-bit-text",
      });

      if (chunk.selectedPhrase.includes(bit.text)) {
        textEl.addClass("jp-col-ctx-bit-text--highlight");
      }
      if (matchesSearch) {
        textEl.addClass("jp-col-ctx-bit-text--search-match");
      }

      // Category + function labels
      if (bit.category) {
        const catLabel = bitEl.createSpan({
          text: bit.category,
          cls: "jp-col-ctx-bit-cat",
        });
        catLabel.style.setProperty("color", colour);
      }
      for (const fn of bit.functions) {
        bitEl.createSpan({
          text: fn,
          cls: "jp-col-ctx-bit-label",
        });
      }
    }

    // Show relation arrows between connected bits
    if (chunk.relations.length > 0) {
      const relSection = parent.createDiv("jp-col-ctx-relations");
      relSection.createEl("small", { text: "Connections:", cls: "jp-col-ctx-rel-header" });

      for (const rel of chunk.relations) {
        const fromBit = chunk.bits.find(b => b.id === rel.fromBitId);
        const toBit = chunk.bits.find(b => b.id === rel.toBitId);
        if (!fromBit || !toBit) continue;

        const colour = colourForBit(toBit);

        const relEl = relSection.createDiv("jp-col-ctx-relation");
        relEl.style.setProperty("--rel-color", colour);

        const fromTrunc = fromBit.text.length > 20 ? fromBit.text.slice(0, 20) + "…" : fromBit.text;
        const toTrunc = toBit.text.length > 20 ? toBit.text.slice(0, 20) + "…" : toBit.text;

        relEl.createSpan({ text: fromTrunc, cls: "jp-col-ctx-rel-from" });
        relEl.createSpan({ text: " → ", cls: "jp-col-ctx-rel-arrow" });
        relEl.createSpan({ text: toTrunc, cls: "jp-col-ctx-rel-to" });
        relEl.createSpan({
          text: ` (${rel.relationType})`,
          cls: "jp-col-ctx-rel-type",
        });
      }
    }
  }

  private renderEntry(parent: HTMLElement, entry: ContextEntry, _chunk: ContextChunk): void {
    const card = parent.createDiv("jp-col-ctx-entry-card");

    // Tags
    if (entry.tags.length > 0) {
      const tagRow = card.createDiv("jp-col-ctx-entry-tags");
      for (const t of entry.tags) {
        tagRow.createSpan({ text: t, cls: "jp-col-ctx-tag" });
      }
    }

    // Formatted content
    const content = card.createDiv("jp-col-ctx-entry-content");
    for (const line of entry.formattedMarkdown.split("\n")) {
      const trimmed = line.replace(/^>\s?/, "");
      if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
        content.createEl("strong", { text: trimmed.replace(/\*\*/g, "") });
      } else if (trimmed.startsWith("_") && trimmed.includes("_:")) {
        content.createEl("em", { text: trimmed.replace(/_/g, "") });
      } else {
        content.createEl("span", { text: trimmed });
      }
      content.createEl("br");
    }

    // Delete button
    const delBtn = card.createEl("button", {
      text: "×",
      cls: "jp-col-action-btn jp-col-action-btn--danger",
    });
    delBtn.addEventListener("click", () => {
      this.contextStore.deleteEntry(entry.id);
      card.remove();
    });
  }

  private collectTags(entries: ContextEntry[]): string[] {
    const tagSet = new Set<string>();
    for (const e of entries) {
      for (const t of e.tags) tagSet.add(t);
    }
    return Array.from(tagSet).sort();
  }

  private groupByChunk(entries: ContextEntry[], chunks: ContextChunk[]): { chunk: ContextChunk; entries: ContextEntry[] }[] {
    const map = new Map<string, ContextEntry[]>();
    for (const e of entries) {
      if (!map.has(e.chunkId)) map.set(e.chunkId, []);
      map.get(e.chunkId)!.push(e);
    }

    const result: { chunk: ContextChunk; entries: ContextEntry[] }[] = [];
    for (const [chunkId, entryList] of map) {
      const chunk = chunks.find(c => c.id === chunkId);
      if (chunk) {
        result.push({ chunk, entries: entryList });
      }
    }

    return result.sort((a, b) => b.chunk.createdAt - a.chunk.createdAt);
  }

  refresh(): void {
    this.render();
  }
}
