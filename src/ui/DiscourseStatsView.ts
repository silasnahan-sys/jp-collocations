import { ItemView, WorkspaceLeaf } from "obsidian";
import type { DiscourseStore } from "../data/DiscourseStore.ts";
import type { DiscourseStats } from "../types.ts";

export const DISCOURSE_STATS_VIEW_TYPE = "jp-collocations-discourse-stats";

const CATEGORY_COLOURS: Record<string, string> = {
  "topic-initiation": "#4CAF50",
  "reasoning":        "#2196F3",
  "modality":         "#9C27B0",
  "connective":       "#FF9800",
  "confirmation":     "#00BCD4",
  "rephrasing":       "#795548",
  "filler":           "#607D8B",
  "quotation":        "#E91E63",
};

const CATEGORY_LABELS: Record<string, string> = {
  "topic-initiation": "話題開始",
  "reasoning":        "理由・説明",
  "modality":         "モダリティ",
  "connective":       "接続",
  "confirmation":     "確認",
  "rephrasing":       "言い換え",
  "filler":           "フィラー",
  "quotation":        "引用",
};

export class DiscourseStatsView extends ItemView {
  private discourseStore: DiscourseStore;
  private statsContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, discourseStore: DiscourseStore) {
    super(leaf);
    this.discourseStore = discourseStore;
  }

  getViewType(): string {
    return DISCOURSE_STATS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "談話統計";
  }

  getIcon(): string {
    return "bar-chart-2";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-discourse-stats-view");

    const header = container.createDiv("jp-ds-header");
    header.createEl("h4", { text: "談話コンテキスト統計", cls: "jp-ds-title" });

    const refreshBtn = header.createEl("button", { text: "⟳", cls: "jp-ds-refresh-btn", title: "Refresh" });
    refreshBtn.addEventListener("click", () => this.refresh());

    this.statsContainer = container.createDiv("jp-ds-body");
    this.refresh();
  }

  async onClose(): Promise<void> {
    // nothing
  }

  refresh(): void {
    if (!this.statsContainer) return;
    this.statsContainer.empty();

    const stats = this.discourseStore.getStats();

    // Summary row
    const summary = this.statsContainer.createDiv("jp-ds-summary");
    summary.createEl("span", { text: `${stats.totalChunks} コンテキスト`, cls: "jp-ds-total" });

    if (stats.totalChunks === 0) {
      this.statsContainer.createEl("p", {
        text: "まだ談話コンテキストがありません。jp-sentence-surferでテキストをキャプチャしてください。",
        cls: "jp-ds-empty",
      });
      return;
    }

    // Category breakdown
    this.statsContainer.createEl("h5", { text: "カテゴリ別", cls: "jp-ds-section-title" });
    const catSection = this.statsContainer.createDiv("jp-ds-categories");
    const maxCatCount = Math.max(...Object.values(stats.byCategory), 1);

    for (const cat of Object.keys(CATEGORY_LABELS)) {
      const count = stats.byCategory[cat] ?? 0;
      const row = catSection.createDiv("jp-ds-cat-row");
      const label = CATEGORY_LABELS[cat] ?? cat;
      row.createEl("span", { text: label, cls: "jp-ds-cat-label" });
      const barWrap = row.createDiv("jp-ds-bar-wrap");
      const bar = barWrap.createDiv("jp-ds-bar");
      bar.style.width = `${Math.round((count / maxCatCount) * 100)}%`;
      bar.style.background = CATEGORY_COLOURS[cat] ?? "#888";
      row.createEl("span", { text: String(count), cls: "jp-ds-cat-count" });
    }

    // Top markers
    if (stats.topMarkers.length > 0) {
      this.statsContainer.createEl("h5", { text: "頻出マーカー Top 10", cls: "jp-ds-section-title" });
      const markerList = this.statsContainer.createEl("ol", { cls: "jp-ds-marker-list" });
      for (const m of stats.topMarkers.slice(0, 10)) {
        const li = markerList.createEl("li", { cls: "jp-ds-marker-item" });
        li.createEl("span", { text: m.surface, cls: "jp-ds-marker-surface" });
        li.createEl("span", { text: ` ×${m.count}`, cls: "jp-ds-marker-count" });
      }
    }

    // Top collocations by context count
    if (stats.topCollocations.length > 0) {
      this.statsContainer.createEl("h5", { text: "コンテキスト数上位 Top 10", cls: "jp-ds-section-title" });
      const colList = this.statsContainer.createEl("ol", { cls: "jp-ds-col-list" });
      for (const c of stats.topCollocations.slice(0, 10)) {
        const li = colList.createEl("li", { cls: "jp-ds-col-item" });
        li.createEl("span", { text: c.id, cls: "jp-ds-col-id" });
        li.createEl("span", { text: ` ${c.contextCount} ctx`, cls: "jp-ds-col-count" });
      }
    }
  }
}
