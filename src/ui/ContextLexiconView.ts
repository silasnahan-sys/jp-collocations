import { ItemView, WorkspaceLeaf } from "obsidian";
import { CATEGORY_COLOURS } from "../types.ts";
import type { DiscourseCategory } from "../types.ts";
import { ContextStore } from "../data/ContextStore.ts";
import type { ContextBitRecord } from "../data/ContextStore.ts";
import { DiscourseAnalyzer } from "../discourse/DiscourseAnalyzer.ts";

export const CONTEXT_LEXICON_VIEW_TYPE = "jp-context-lexicon-view";

const CATEGORIES: DiscourseCategory[] = [
  "hedging", "epistemic", "interactional", "causal-logical",
  "enumerative", "referential", "stance", "structural",
];

export class ContextLexiconView extends ItemView {
  private contextStore: ContextStore;
  private analyzer = new DiscourseAnalyzer();
  private activeCategory: DiscourseCategory | null = null;
  private bodyContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, contextStore: ContextStore) {
    super(leaf);
    this.contextStore = contextStore;
  }

  getViewType(): string { return CONTEXT_LEXICON_VIEW_TYPE; }
  getDisplayText(): string { return "Context Lexicon"; }
  getIcon(): string { return "library"; }

  async onOpen(): Promise<void> {
    this.buildUI();
  }

  async onClose(): Promise<void> { /* nothing */ }

  private buildUI(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-context-lexicon-view");

    const header = container.createDiv("jp-ctx-header");
    header.createEl("h4", { text: "Context Lexicon", cls: "jp-ctx-title" });

    // Category filter chips
    const chipRow = container.createDiv("jp-ctx-chips");
    for (const cat of CATEGORIES) {
      const chip = chipRow.createEl("span", { text: cat, cls: "jp-ctx-chip" });
      chip.style.borderColor = CATEGORY_COLOURS[cat];
      chip.addEventListener("click", () => {
        if (this.activeCategory === cat) {
          this.activeCategory = null;
          chip.removeClass("jp-ctx-chip--active");
        } else {
          this.activeCategory = cat;
          chipRow.querySelectorAll(".jp-ctx-chip--active").forEach(el => el.removeClass("jp-ctx-chip--active"));
          chip.addClass("jp-ctx-chip--active");
        }
        this.renderBody();
      });
    }

    this.bodyContainer = container.createDiv("jp-ctx-body");
    this.renderBody();
  }

  refresh(): void {
    this.renderBody();
  }

  private renderBody(): void {
    if (!this.bodyContainer) return;
    this.bodyContainer.empty();

    const records = this.activeCategory
      ? this.contextStore.getByCategory(this.activeCategory)
      : this.getAllRecords();

    if (records.length === 0) {
      this.bodyContainer.createDiv({ text: "No discourse bits loaded. Analyse text via the Discourse Cards view.", cls: "jp-ctx-empty" });
      return;
    }

    for (const rec of records) {
      this.renderCard(this.bodyContainer, rec);
    }
  }

  private getAllRecords(): ContextBitRecord[] {
    const all: ContextBitRecord[] = [];
    for (const cat of CATEGORIES) {
      all.push(...this.contextStore.getByCategory(cat));
    }
    return all;
  }

  private renderCard(parent: HTMLElement, rec: ContextBitRecord): void {
    const card = parent.createDiv("jp-ctx-card");
    const colour = CATEGORY_COLOURS[rec.category] ?? "#cccccc";
    card.style.borderLeft = `4px solid ${colour}`;

    const topRow = card.createDiv("jp-ctx-card-top");
    topRow.createEl("span", { text: rec.bit.text, cls: "jp-ctx-bit-text" });
    topRow.createEl("span", { text: rec.category, cls: "jp-ctx-cat-badge" }).style.color = colour;

    const meta = card.createDiv("jp-ctx-card-meta");
    meta.createEl("span", { text: `type: ${rec.bit.bitType}`, cls: "jp-ctx-meta-item" });
    if (rec.speaker) meta.createEl("span", { text: `speaker: ${rec.speaker}`, cls: "jp-ctx-meta-item" });
    if (rec.bit.timestamp) meta.createEl("span", { text: rec.bit.timestamp, cls: "jp-ctx-meta-item" });
    if (rec.bit.morphemes.length > 0) {
      meta.createEl("span", { text: `morphemes: ${rec.bit.morphemes.join(" | ")}`, cls: "jp-ctx-meta-item" });
    }
  }
}
