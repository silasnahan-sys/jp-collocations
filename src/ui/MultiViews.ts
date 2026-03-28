import { ItemView, WorkspaceLeaf } from "obsidian";
import type { CollocationStore } from "../data/CollocationStore.ts";
import type { SearchEngine } from "../search/SearchEngine.ts";
import type { PluginSettings } from "../types.ts";

// ────────────────────────────────────────────────────────────────────────────
// ViewSwitcher — tab bar shared by multi-view panels
// ────────────────────────────────────────────────────────────────────────────

export type ViewTab = "grammar" | "connections" | "forms" | "context";

const TAB_LABELS: Record<ViewTab, string> = {
  grammar:     "文法",
  connections: "接続",
  forms:       "活用",
  context:     "文脈",
};

export class ViewSwitcher {
  private tabs: Record<ViewTab, HTMLElement> = {} as Record<ViewTab, HTMLElement>;
  private current: ViewTab;
  private onChange: (tab: ViewTab) => void;

  constructor(container: HTMLElement, initial: ViewTab, onChange: (tab: ViewTab) => void) {
    this.current = initial;
    this.onChange = onChange;
    const bar = container.createDiv("jp-view-switcher");
    for (const [key, label] of Object.entries(TAB_LABELS) as Array<[ViewTab, string]>) {
      const btn = bar.createEl("button", { text: label, cls: "jp-vs-tab" });
      if (key === initial) btn.addClass("jp-vs-tab--active");
      btn.addEventListener("click", () => this.select(key));
      this.tabs[key] = btn;
    }
  }

  select(tab: ViewTab): void {
    Object.values(this.tabs).forEach(t => t.removeClass("jp-vs-tab--active"));
    this.tabs[tab].addClass("jp-vs-tab--active");
    this.current = tab;
    this.onChange(tab);
  }

  getCurrent(): ViewTab {
    return this.current;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// GrammarBrowserView
// ────────────────────────────────────────────────────────────────────────────

export const GRAMMAR_BROWSER_VIEW_TYPE = "jp-collocations-grammar-browser";

export class GrammarBrowserView extends ItemView {
  private store: CollocationStore;
  private engine: SearchEngine;
  private settings: PluginSettings;
  private bodyEl: HTMLElement | null = null;
  private currentTab: ViewTab = "grammar";

  constructor(
    leaf: WorkspaceLeaf,
    store: CollocationStore,
    engine: SearchEngine,
    settings: PluginSettings
  ) {
    super(leaf);
    this.store = store;
    this.engine = engine;
    this.settings = settings;
  }

  getViewType(): string { return GRAMMAR_BROWSER_VIEW_TYPE; }
  getDisplayText(): string { return "文法ブラウザ"; }
  getIcon(): string { return "book-open"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-grammar-browser-view");

    container.createEl("h4", { text: "文法ブラウザ", cls: "jp-gbv-title" });

    new ViewSwitcher(container, "grammar", tab => {
      this.currentTab = tab;
      this.renderBody();
    });

    this.bodyEl = container.createDiv("jp-gbv-body");
    this.renderBody();
  }

  async onClose(): Promise<void> {}

  private renderBody(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    switch (this.currentTab) {
      case "grammar":     this.renderGrammarPanel(); break;
      case "connections": this.renderConnectionsPanel(); break;
      case "forms":       this.renderFormsPanel(); break;
      case "context":     this.renderContextPanel(); break;
    }
  }

  private renderGrammarPanel(): void {
    const patterns = this.store.getAllPatterns();
    if (patterns.length === 0) {
      this.bodyEl!.createEl("p", { text: "パターンデータなし", cls: "jp-gbv-empty" });
      return;
    }
    const list = this.bodyEl!.createEl("ul", { cls: "jp-gbv-pattern-list" });
    for (const p of patterns) {
      const entries = this.store.getByPattern(p);
      const li = list.createEl("li", { cls: "jp-gbv-pattern-item" });
      li.createEl("span", { text: p, cls: "jp-gbv-pattern-name" });
      li.createEl("span", { text: ` (${entries.length})`, cls: "jp-gbv-pattern-count" });
    }
  }

  private renderConnectionsPanel(): void {
    this.bodyEl!.createEl("p", { text: "接続パターン分析", cls: "jp-gbv-section" });
    const entries = this.store.getAll().slice(0, 50);
    const list = this.bodyEl!.createEl("ul", { cls: "jp-gbv-conn-list" });
    for (const e of entries) {
      const li = list.createEl("li", { cls: "jp-gbv-conn-item" });
      li.createEl("span", { text: `${e.headword} → ${e.collocate}`, cls: "jp-gbv-conn-pair" });
      li.createEl("span", { text: ` [${e.pattern}]`, cls: "jp-gbv-conn-pattern" });
    }
  }

  private renderFormsPanel(): void {
    this.bodyEl!.createEl("p", { text: "活用形バリエーション", cls: "jp-gbv-section" });
    const tags = this.store.getAllTags();
    const tagCloud = this.bodyEl!.createDiv("jp-gbv-tag-cloud");
    for (const tag of tags) {
      tagCloud.createEl("span", { text: tag, cls: "jp-gbv-tag-chip" });
    }
  }

  private renderContextPanel(): void {
    this.bodyEl!.createEl("p", { text: "ソース文脈", cls: "jp-gbv-section" });
    const entries = this.store.getAll().filter(e => e.exampleSentences.length > 0).slice(0, 20);
    for (const e of entries) {
      const card = this.bodyEl!.createDiv("jp-gbv-ctx-card");
      card.createEl("strong", { text: e.headword, cls: "jp-gbv-ctx-hw" });
      card.createEl("p", { text: e.exampleSentences[0], cls: "jp-gbv-ctx-sentence" });
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ConnectionMapView
// ────────────────────────────────────────────────────────────────────────────

export const CONNECTION_MAP_VIEW_TYPE = "jp-collocations-connection-map";

export class ConnectionMapView extends ItemView {
  private store: CollocationStore;

  constructor(leaf: WorkspaceLeaf, store: CollocationStore) {
    super(leaf);
    this.store = store;
  }

  getViewType(): string { return CONNECTION_MAP_VIEW_TYPE; }
  getDisplayText(): string { return "接続マップ"; }
  getIcon(): string { return "git-branch"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-connection-map-view");

    container.createEl("h4", { text: "コロケーション接続マップ", cls: "jp-cmv-title" });

    const body = container.createDiv("jp-cmv-body");
    const entries = this.store.getAll();

    if (entries.length === 0) {
      body.createEl("p", { text: "エントリーなし", cls: "jp-cmv-empty" });
      return;
    }

    // Build headword → collocates map
    const byHW: Record<string, string[]> = {};
    for (const e of entries) {
      if (!byHW[e.headword]) byHW[e.headword] = [];
      if (!byHW[e.headword].includes(e.collocate)) byHW[e.headword].push(e.collocate);
    }

    const list = body.createEl("ul", { cls: "jp-cmv-list" });
    for (const [hw, colls] of Object.entries(byHW).slice(0, 40)) {
      const li = list.createEl("li", { cls: "jp-cmv-item" });
      li.createEl("strong", { text: hw, cls: "jp-cmv-hw" });
      li.createEl("span", { text: " → " + colls.join("、"), cls: "jp-cmv-colls" });
    }
  }

  async onClose(): Promise<void> {}
}

// ────────────────────────────────────────────────────────────────────────────
// FormVariationsView
// ────────────────────────────────────────────────────────────────────────────

export const FORM_VARIATIONS_VIEW_TYPE = "jp-collocations-form-variations";

export class FormVariationsView extends ItemView {
  private store: CollocationStore;

  constructor(leaf: WorkspaceLeaf, store: CollocationStore) {
    super(leaf);
    this.store = store;
  }

  getViewType(): string { return FORM_VARIATIONS_VIEW_TYPE; }
  getDisplayText(): string { return "活用バリエーション"; }
  getIcon(): string { return "list-tree"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-form-variations-view");

    container.createEl("h4", { text: "活用形バリエーション", cls: "jp-fvv-title" });

    const body = container.createDiv("jp-fvv-body");
    const entries = this.store.getAll();

    // Group by headword, show each unique collocate with its pattern
    const groups: Record<string, Array<{ collocate: string; pattern: string }>> = {};
    for (const e of entries) {
      if (!groups[e.headword]) groups[e.headword] = [];
      if (!groups[e.headword].some(x => x.collocate === e.collocate)) {
        groups[e.headword].push({ collocate: e.collocate, pattern: e.pattern });
      }
    }

    if (Object.keys(groups).length === 0) {
      body.createEl("p", { text: "エントリーなし", cls: "jp-fvv-empty" });
      return;
    }

    for (const [hw, forms] of Object.entries(groups).slice(0, 30)) {
      const card = body.createDiv("jp-fvv-card");
      card.createEl("h5", { text: hw, cls: "jp-fvv-hw" });
      const ul = card.createEl("ul", { cls: "jp-fvv-form-list" });
      for (const f of forms) {
        const li = ul.createEl("li", { cls: "jp-fvv-form-item" });
        li.createEl("span", { text: f.collocate, cls: "jp-fvv-collocate" });
        li.createEl("span", { text: ` [${f.pattern}]`, cls: "jp-fvv-pattern" });
      }
    }
  }

  async onClose(): Promise<void> {}
}

// ────────────────────────────────────────────────────────────────────────────
// SourceContextView
// ────────────────────────────────────────────────────────────────────────────

export const SOURCE_CONTEXT_VIEW_TYPE = "jp-collocations-source-context";

export class SourceContextView extends ItemView {
  private store: CollocationStore;

  constructor(leaf: WorkspaceLeaf, store: CollocationStore) {
    super(leaf);
    this.store = store;
  }

  getViewType(): string { return SOURCE_CONTEXT_VIEW_TYPE; }
  getDisplayText(): string { return "ソース文脈"; }
  getIcon(): string { return "file-text"; }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("jp-source-context-view");

    container.createEl("h4", { text: "ソース文脈ブラウザ", cls: "jp-scv-title" });

    const body = container.createDiv("jp-scv-body");
    const entries = this.store.getAll().filter(e => e.exampleSentences.length > 0);

    if (entries.length === 0) {
      body.createEl("p", { text: "例文なし", cls: "jp-scv-empty" });
      return;
    }

    for (const e of entries.slice(0, 50)) {
      const card = body.createDiv("jp-scv-card");
      const titleRow = card.createDiv("jp-scv-title-row");
      titleRow.createEl("strong", { text: e.headword, cls: "jp-scv-hw" });
      titleRow.createEl("span", { text: ` + ${e.collocate}`, cls: "jp-scv-collocate" });
      for (const s of e.exampleSentences.slice(0, 2)) {
        card.createEl("p", { text: s, cls: "jp-scv-sentence" });
      }
      if (e.notes) {
        card.createEl("p", { text: e.notes, cls: "jp-scv-notes" });
      }
    }
  }

  async onClose(): Promise<void> {}
}
