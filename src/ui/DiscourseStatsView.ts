import { ItemView, WorkspaceLeaf } from "obsidian";
import type { DiscourseCategory } from "../types.ts";
import type { DiscourseStore } from "../data/DiscourseStore.ts";
import type { CollocationStore } from "../data/CollocationStore.ts";

export const DISCOURSE_STATS_VIEW_TYPE = "jp-discourse-stats-view";

const CATEGORY_LABELS: Record<DiscourseCategory, string> = {
  "topic-initiation": "話題開始",
  "reasoning": "理由・説明",
  "modality": "文末モダリティ",
  "connective": "接続・展開",
  "confirmation": "確認・同意要求",
  "rephrasing": "言い換え・修正",
  "filler": "フィラー・ヘッジ",
  "quotation": "引用・伝聞",
};

const CATEGORY_COLOURS: Record<DiscourseCategory, string> = {
  "topic-initiation": "#4a9eff",
  "reasoning": "#f5a623",
  "modality": "#9b59b6",
  "connective": "#2ecc71",
  "confirmation": "#e74c3c",
  "rephrasing": "#1abc9c",
  "filler": "#95a5a6",
  "quotation": "#e67e22",
};

export class DiscourseStatsView extends ItemView {
  private discourseStore: DiscourseStore;
  private collocationStore: CollocationStore;

  constructor(
    leaf: WorkspaceLeaf,
    discourseStore: DiscourseStore,
    collocationStore: CollocationStore
  ) {
    super(leaf);
    this.discourseStore = discourseStore;
    this.collocationStore = collocationStore;
  }

  getViewType(): string {
    return DISCOURSE_STATS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Discourse Stats";
  }

  getIcon(): string {
    return "bar-chart-2";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    // nothing
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-discourse-stats-view");

    // Header
    const header = container.createDiv("jp-col-header");
    header.createEl("h4", { text: "談話文法 — Discourse Stats", cls: "jp-col-title" });

    const refreshBtn = header.createEl("button", {
      text: "↻",
      cls: "jp-col-action-btn",
      title: "Refresh",
    });
    refreshBtn.addEventListener("click", () => this.render());

    const stats = this.discourseStore.getStats();

    // Summary row
    const summary = container.createDiv("jp-discourse-stats-summary");
    summary.createEl("span", {
      text: `Total captured chunks: ${stats.totalContexts}`,
      cls: "jp-col-stat-text",
    });

    if (stats.totalContexts === 0) {
      container.createDiv({ text: "No discourse contexts captured yet.", cls: "jp-col-empty" });
      return;
    }

    // Category breakdown
    container.createEl("h5", { text: "Category Breakdown", cls: "jp-discourse-stats-section-title" });
    const categorySection = container.createDiv("jp-discourse-stats-categories");
    this.renderCategoryBreakdown(categorySection, stats.categoryBreakdown);

    // Top markers
    container.createEl("h5", { text: "Most Frequent Discourse Markers", cls: "jp-discourse-stats-section-title" });
    const markerSection = container.createDiv("jp-discourse-stats-markers");
    this.renderTopMarkers(markerSection, stats.markerFrequency, 20);

    // Collocations with most contexts
    container.createEl("h5", { text: "Collocations with Most Contexts", cls: "jp-discourse-stats-section-title" });
    const colSection = container.createDiv("jp-discourse-stats-collocations");
    this.renderTopCollocations(colSection, 10);
  }

  private renderCategoryBreakdown(
    parent: HTMLElement,
    breakdown: Record<DiscourseCategory, number>
  ): void {
    const entries = Object.entries(breakdown) as [DiscourseCategory, number][];
    if (entries.length === 0) {
      parent.createDiv({ text: "No category data.", cls: "jp-col-empty" });
      return;
    }
    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    entries.sort((a, b) => b[1] - a[1]);

    for (const [cat, count] of entries) {
      const row = parent.createDiv("jp-discourse-stat-bar-row");
      const label = row.createDiv("jp-discourse-stat-bar-label");
      label.createSpan({
        text: CATEGORY_LABELS[cat] ?? cat,
        cls: "jp-discourse-category-label",
      });
      label.createSpan({
        text: ` (${cat})`,
        cls: "jp-discourse-category-code",
      });

      const barWrap = row.createDiv("jp-discourse-stat-bar-wrap");
      const pct = total > 0 ? (count / total) * 100 : 0;
      const bar = barWrap.createDiv("jp-discourse-stat-bar");
      bar.style.width = `${pct.toFixed(1)}%`;
      bar.style.backgroundColor = CATEGORY_COLOURS[cat] ?? "#888";

      row.createSpan({ text: String(count), cls: "jp-discourse-stat-count" });
    }
  }

  private renderTopMarkers(
    parent: HTMLElement,
    markerFreq: Record<string, number>,
    topN: number
  ): void {
    const entries = Object.entries(markerFreq).sort((a, b) => b[1] - a[1]).slice(0, topN);
    if (entries.length === 0) {
      parent.createDiv({ text: "No marker data.", cls: "jp-col-empty" });
      return;
    }
    const maxCount = entries[0][1];
    for (const [surface, count] of entries) {
      const row = parent.createDiv("jp-discourse-stat-bar-row");
      const label = row.createDiv("jp-discourse-stat-bar-label");
      label.createSpan({ text: surface, cls: "jp-discourse-marker-surface" });

      const barWrap = row.createDiv("jp-discourse-stat-bar-wrap");
      const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
      const bar = barWrap.createDiv("jp-discourse-stat-bar");
      bar.style.width = `${pct.toFixed(1)}%`;
      bar.style.backgroundColor = "#4a9eff";

      row.createSpan({ text: String(count), cls: "jp-discourse-stat-count" });
    }
  }

  private renderTopCollocations(parent: HTMLElement, topN: number): void {
    const index = this.discourseStore.getIndex();
    const entries = Object.entries(index.collocationToChunkIds)
      .map(([colId, ids]) => ({ colId, count: ids.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);

    if (entries.length === 0) {
      parent.createDiv({ text: "No data.", cls: "jp-col-empty" });
      return;
    }

    for (const { colId, count } of entries) {
      const entry = this.collocationStore.getById(colId);
      const label = entry ? (entry.fullPhrase || entry.headword) : colId;
      const row = parent.createDiv("jp-discourse-stat-col-row");
      row.createSpan({ text: label, cls: "jp-col-headword" });
      row.createSpan({ text: ` — ${count} context${count !== 1 ? "s" : ""}`, cls: "jp-col-stat-text" });
    }
  }
}
