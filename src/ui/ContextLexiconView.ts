import type { ContextEntry, ContextChunk, DiscourseBit, DiscourseRelation } from "../types.ts";
import type { ContextStore } from "../data/ContextStore.ts";

/**
 * Colour palette shared with DiscourseCardView.
 */
const CONNECTION_COLOURS = [
  "#e06c75", "#4a90d9", "#98c379", "#e5c07b",
  "#c678dd", "#56b6c2", "#d19a66", "#be5046",
];

function colourForGroup(group: number): string {
  return CONNECTION_COLOURS[group % CONNECTION_COLOURS.length];
}

/**
 * ContextLexiconView — a browsable index of all context entries.
 *
 * Unlike the DiscourseCardView (which uses spoiler / reveal UX for card study),
 * this view shows everything visibly so you can browse, compare, and capture
 * variations and different perspectives across the corpus.
 */
export class ContextLexiconView {
  private container: HTMLElement;
  private contextStore: ContextStore;
  private filterTag: string | null = null;

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
    const toolbar = this.container.createDiv("jp-col-browser-toolbar");
    toolbar.createSpan({
      text: `${entries.length} entries across ${chunks.length} chunks`,
      cls: "jp-col-browser-label",
    });

    // Tag filter chips
    const allTags = this.collectTags(entries);
    if (allTags.length > 0) {
      const tagRow = this.container.createDiv("jp-col-filter-row");
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
      const clearBtn = tagRow.createEl("span", { text: "✕ clear", cls: "jp-col-chip jp-col-chip--clear" });
      clearBtn.addEventListener("click", () => {
        this.filterTag = null;
        this.render();
      });
    }

    // Group entries by chunk for organisation
    const grouped = this.groupByChunk(entries, chunks);

    const list = this.container.createDiv("jp-col-ctx-list");
    for (const group of grouped) {
      if (this.filterTag) {
        const hasTag = group.entries.some(e => e.tags.includes(this.filterTag!));
        if (!hasTag) continue;
      }
      this.renderChunkGroup(list, group.chunk, group.entries);
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
      text: `${entries.length} entries`,
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
   * and colour-coded connection indicators.
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

      const bitEl = chunkEl.createDiv("jp-col-ctx-bit");
      bitEl.style.setProperty("--connection-color", colourForGroup(bit.connectionGroup));

      // Colour-coded left border
      bitEl.createDiv("jp-col-ctx-bit-indicator");

      const textEl = bitEl.createSpan({
        text: bit.text,
        cls: "jp-col-ctx-bit-text",
      });

      // If the bit text is part of the selected phrase, bold it
      if (chunk.selectedPhrase.includes(bit.text)) {
        textEl.addClass("jp-col-ctx-bit-text--highlight");
      }

      // Discourse label
      if (bit.discourseLabel) {
        bitEl.createSpan({
          text: bit.discourseLabel,
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

        const relEl = relSection.createDiv("jp-col-ctx-relation");
        relEl.style.setProperty("--rel-color", colourForGroup(rel.connectionGroup));

        const fromTrunc = fromBit.text.length > 20 ? fromBit.text.slice(0, 20) + "…" : fromBit.text;
        const toTrunc = toBit.text.length > 20 ? toBit.text.slice(0, 20) + "…" : toBit.text;

        relEl.createSpan({ text: fromTrunc, cls: "jp-col-ctx-rel-from" });
        relEl.createSpan({ text: ` → `, cls: "jp-col-ctx-rel-arrow" });
        relEl.createSpan({ text: toTrunc, cls: "jp-col-ctx-rel-to" });
        relEl.createSpan({
          text: ` (${rel.relationType})`,
          cls: "jp-col-ctx-rel-type",
        });
      }
    }
  }

  private renderEntry(parent: HTMLElement, entry: ContextEntry, chunk: ContextChunk): void {
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
    // Render markdown-like content as styled HTML
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
