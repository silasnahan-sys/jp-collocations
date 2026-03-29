import { ItemView, WorkspaceLeaf } from "obsidian";
import type { CollocationStore } from "../data/CollocationStore.ts";
import {
  computeDiscourseStats,
  groupByPattern,
  filterDiscourseMarkers,
  parseAll,
} from "../parser/CollocationParser.ts";
import type { CollocationPattern } from "../parser/CollocationParser.ts";
import type { DiscourseCategory } from "../surfer-types.ts";

export const DISCOURSE_VIEW_TYPE = "jp-collocations-discourse-view";

// Colour palette for discourse categories
const CATEGORY_COLOURS: Record<DiscourseCategory, string> = {
  "topic-initiation": "#4C9BE8",
  "reasoning":        "#E8854C",
  "modality":         "#9B59B6",
  "connective":       "#27AE60",
  "confirmation":     "#F1C40F",
  "rephrasing":       "#1ABC9C",
  "filler":           "#95A5A6",
  "quotation":        "#E74C3C",
};

const CATEGORY_LABELS: Record<DiscourseCategory, string> = {
  "topic-initiation": "話題転換",
  "reasoning":        "理由・根拠",
  "modality":         "モダリティ",
  "connective":       "接続表現",
  "confirmation":     "確認・共有",
  "rephrasing":       "言い換え",
  "filler":           "フィラー",
  "quotation":        "引用",
};

const PATTERN_LABELS: Record<CollocationPattern, string> = {
  "N+V":             "名詞＋動詞",
  "V+N":             "動詞＋名詞",
  "N+の+N":          "名詞＋の＋名詞",
  "V+て+V":          "Vて＋V",
  "Adj+N":           "形容詞＋名詞",
  "N+に+V":          "名詞＋に＋動詞",
  "N+を+V":          "名詞＋を＋動詞",
  "V+ながら":        "Vながら",
  "V+てから":        "Vてから",
  "set-phrase":      "慣用表現",
  "discourse-marker":"談話標識",
  "unknown":         "その他",
};

export class DiscourseView extends ItemView {
  private store: CollocationStore;

  constructor(leaf: WorkspaceLeaf, store: CollocationStore) {
    super(leaf);
    this.store = store;
  }

  getViewType(): string {
    return DISCOURSE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Discourse Analysis";
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

  /** Re-render the view (called after store updates). */
  refresh(): void {
    this.render();
  }

  private render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-discourse-view");

    const entries = this.store.getAll();
    const stats = computeDiscourseStats(entries);
    const parsed = parseAll(entries);
    const discourseMarkers = filterDiscourseMarkers(parsed);
    const byPattern = groupByPattern(parsed);

    // ── Header ──────────────────────────────────────────────────────────────
    const header = container.createEl("div", { cls: "jp-discourse-header" });
    header.createEl("h2", { text: "談話文法 Discourse Grammar" });
    header.createEl("p", {
      text: `${entries.length} entries · ${stats.discourseMarkerCount} discourse markers`,
      cls: "jp-discourse-subtitle",
    });

    // ── Category distribution bar chart ────────────────────────────────────
    const catSection = container.createEl("div", { cls: "jp-discourse-section" });
    catSection.createEl("h3", { text: "カテゴリー分布 Category Distribution" });

    const chartWrap = catSection.createEl("div", { cls: "jp-discourse-chart" });

    const allCats = Object.keys(CATEGORY_COLOURS) as DiscourseCategory[];
    const maxCatCount = Math.max(1, ...allCats.map(c => stats.byCategoryCount.get(c) ?? 0));

    for (const cat of allCats) {
      const count = stats.byCategoryCount.get(cat) ?? 0;
      const pct = Math.round((count / maxCatCount) * 100);

      const row = chartWrap.createEl("div", { cls: "jp-discourse-bar-row" });
      const label = row.createEl("span", { cls: "jp-discourse-bar-label" });
      label.setText(CATEGORY_LABELS[cat]);

      const barWrap = row.createEl("div", { cls: "jp-discourse-bar-wrap" });
      const bar = barWrap.createEl("div", { cls: "jp-discourse-bar" });
      bar.style.width = `${pct}%`;
      bar.style.backgroundColor = CATEGORY_COLOURS[cat];
      bar.setAttribute("title", `${count} entries`);

      row.createEl("span", { cls: "jp-discourse-bar-count", text: String(count) });
    }

    // ── Pattern distribution ────────────────────────────────────────────────
    const patSection = container.createEl("div", { cls: "jp-discourse-section" });
    patSection.createEl("h3", { text: "構造パターン Structural Patterns" });

    const patGrid = patSection.createEl("div", { cls: "jp-discourse-pattern-grid" });
    const sortedPatterns = [...byPattern.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [pattern, group] of sortedPatterns) {
      const tile = patGrid.createEl("div", { cls: "jp-discourse-pattern-tile" });
      tile.createEl("div", { cls: "jp-discourse-pattern-name", text: PATTERN_LABELS[pattern] });
      tile.createEl("div", { cls: "jp-discourse-pattern-count", text: String(group.length) });
    }

    // ── Register distribution ───────────────────────────────────────────────
    const regSection = container.createEl("div", { cls: "jp-discourse-section" });
    regSection.createEl("h3", { text: "語用論的レジスター Register" });

    const regRow = regSection.createEl("div", { cls: "jp-discourse-register-row" });
    const registers: Array<["formal" | "neutral" | "informal", string, string]> = [
      ["formal",   "丁寧体",   "#3498DB"],
      ["neutral",  "普通体",   "#2ECC71"],
      ["informal", "くだけた", "#E67E22"],
    ];
    for (const [reg, label, colour] of registers) {
      const count = stats.byRegisterCount.get(reg) ?? 0;
      const badge = regRow.createEl("div", { cls: "jp-discourse-register-badge" });
      badge.style.borderColor = colour;
      badge.createEl("span", { cls: "jp-discourse-register-label", text: label });
      badge.createEl("span", { cls: "jp-discourse-register-count", text: String(count) });
    }

    // ── Discourse markers list ──────────────────────────────────────────────
    if (discourseMarkers.length > 0) {
      const dmSection = container.createEl("div", { cls: "jp-discourse-section" });
      dmSection.createEl("h3", { text: "談話標識一覧 Discourse Marker List" });

      const table = dmSection.createEl("table", { cls: "jp-discourse-table" });
      const thead = table.createEl("thead");
      const headRow = thead.createEl("tr");
      ["表層形", "カテゴリー", "位置", "語用機能"].forEach(h =>
        headRow.createEl("th", { text: h })
      );

      const tbody = table.createEl("tbody");
      for (const p of discourseMarkers) {
        const ann = p.discourseAnnotation;
        if (!ann) continue;
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: p.entry.fullPhrase ?? p.entry.headword });
        const catTd = tr.createEl("td");
        const catBadge = catTd.createEl("span", {
          cls: "jp-discourse-cat-badge",
          text: CATEGORY_LABELS[ann.category],
        });
        catBadge.style.backgroundColor = CATEGORY_COLOURS[ann.category];
        tr.createEl("td", { text: ann.position });
        tr.createEl("td", { text: ann.pragmaticFunction });
      }
    }

    // ── Empty state ─────────────────────────────────────────────────────────
    if (entries.length === 0) {
      container.createEl("div", {
        cls: "jp-discourse-empty",
        text: "コロケーションをまず登録してください。",
      });
    }
  }
}
