import { ItemView, WorkspaceLeaf } from "obsidian";
import { CATEGORY_COLOURS } from "../types.ts";
import type { DiscourseCategory } from "../types.ts";
import type { DiscourseGraph } from "../discourse/discourse-types.ts";
import { DiscourseAnalyzer } from "../discourse/DiscourseAnalyzer.ts";
import { DiscourseVisualizer } from "../discourse/DiscourseVisualizer.ts";

export const DISCOURSE_CARD_VIEW_TYPE = "jp-discourse-card-view";

export class DiscourseCardView extends ItemView {
  private analyzer = new DiscourseAnalyzer();
  private visualizer = new DiscourseVisualizer();
  private currentGraph: DiscourseGraph | null = null;
  private textArea: HTMLTextAreaElement | null = null;
  private graphContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return DISCOURSE_CARD_VIEW_TYPE; }
  getDisplayText(): string { return "Discourse Cards"; }
  getIcon(): string { return "git-fork"; }

  async onOpen(): Promise<void> {
    this.buildUI();
  }

  async onClose(): Promise<void> { /* nothing */ }

  private buildUI(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-discourse-card-view");

    const header = container.createDiv("jp-discourse-header");
    header.createEl("h4", { text: "Discourse Graph", cls: "jp-discourse-title" });

    const inputRow = container.createDiv("jp-discourse-input-row");
    this.textArea = inputRow.createEl("textarea", {
      cls: "jp-discourse-textarea",
      placeholder: "Paste annotated text with || boundaries…",
    });

    const analyzeBtn = inputRow.createEl("button", { text: "Analyse", cls: "jp-discourse-btn" });
    analyzeBtn.addEventListener("click", () => this.runAnalysis());

    this.graphContainer = container.createDiv("jp-discourse-graph");
    this.renderEmpty();
  }

  private renderEmpty(): void {
    if (!this.graphContainer) return;
    this.graphContainer.empty();
    this.graphContainer.createDiv({ text: "Paste annotated text above and click Analyse.", cls: "jp-discourse-empty" });
  }

  private runAnalysis(): void {
    const text = this.textArea?.value ?? "";
    if (!text.trim()) return;
    this.currentGraph = this.analyzer.analyze(text);
    this.renderGraph();
  }

  private renderGraph(): void {
    if (!this.graphContainer || !this.currentGraph) return;
    this.graphContainer.empty();

    const tokens = this.visualizer.toColouredTokens(this.currentGraph);
    const tokenRow = this.graphContainer.createDiv("jp-discourse-tokens");
    for (const token of tokens) {
      const span = tokenRow.createEl("span", { cls: "jp-discourse-token" });
      span.setText(token.text);
      span.style.borderLeft = `4px solid ${token.colour}`;
      span.setAttribute("title", token.type);
    }

    const summary = this.visualizer.toSummaryTable(this.currentGraph);
    const table = this.graphContainer.createEl("table", { cls: "jp-discourse-summary" });
    const thead = table.createEl("thead");
    const headerRow = thead.createEl("tr");
    ["Type", "Count", "Category"].forEach(h => headerRow.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");
    for (const row of summary) {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: row.type });
      tr.createEl("td", { text: String(row.count) });
      const catTd = tr.createEl("td", { text: row.category });
      catTd.style.color = row.colour;
    }

    const adjPre = this.graphContainer.createEl("pre", { cls: "jp-discourse-adj" });
    adjPre.setText(this.visualizer.toAdjacencyList(this.currentGraph));
  }
}
