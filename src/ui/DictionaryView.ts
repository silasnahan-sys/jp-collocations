import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import { DICT_VIEW_TYPE } from "../yomitan/constants.ts";
import { YomitanStore } from "../yomitan/YomitanStore.ts";
import { YomitanDictionary } from "../yomitan/YomitanDictionary.ts";
import { YomitanSearchEngine } from "../yomitan/YomitanSearchEngine.ts";
import type { ImportedDictionary, YomitanEntry, DictionaryBookmark, HistoryEntry } from "../yomitan/types.ts";
import { DICTIONARY_COLORS, DEFAULT_DICTIONARY_COLOR } from "../yomitan/constants.ts";
import { renderEntry } from "./DictionaryEntryRenderer.ts";

type Tab = "shelf" | "bookmarks" | "history" | "more";

export { DICT_VIEW_TYPE };

export class DictionaryView extends ItemView {
  private store: YomitanStore;
  private engine: YomitanSearchEngine;
  private dictionaries: ImportedDictionary[] = [];
  private currentTab: Tab = "shelf";
  private searchQuery = "";
  private selectedDictTitle: string | null = null;
  private searchResults: { dictionaryTitle: string; entries: YomitanEntry[] }[] = [];
  private activeEntry: YomitanEntry | null = null;
  private bookmarks: DictionaryBookmark[] = [];
  private history: HistoryEntry[] = [];
  private fontSize = 15;

  // DOM refs
  private rootEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private suggestionsEl!: HTMLElement;
  private mainContent!: HTMLElement;
  private tabBar!: HTMLElement;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.store = new YomitanStore();
    this.engine = new YomitanSearchEngine(this.store);
  }

  getViewType(): string { return DICT_VIEW_TYPE; }
  getDisplayText(): string { return "辞書"; }
  getIcon(): string { return "book-open"; }

  async onOpen(): Promise<void> {
    await this.store.open();
    this.dictionaries = await this.store.getDictionaries();
    this.bookmarks = await this.store.getBookmarks();
    this.history = await this.store.getHistory();
    this.build();
  }

  async onClose(): Promise<void> { /* cleanup */ }

  private build(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("mkd-view");

    this.rootEl = container.createDiv("mkd-root");

    // Search header
    this.buildSearchHeader();

    // Main content area
    this.mainContent = this.rootEl.createDiv("mkd-main");

    // Tab bar
    this.buildTabBar();

    this.renderCurrentTab();
  }

  private buildSearchHeader(): void {
    const header = this.rootEl.createDiv("mkd-search-header");

    // Dictionary scope pill (shown when a dict is selected)
    const scopePill = header.createDiv("mkd-scope-pill");
    scopePill.style.display = "none";

    const searchWrap = header.createDiv("mkd-search-wrap");
    const searchIcon = searchWrap.createEl("span", { text: "🔍" });
    searchIcon.addClass("mkd-search-icon");

    this.searchInput = searchWrap.createEl("input", {
      type: "text",
      placeholder: "辞書を検索…",
      cls: "mkd-search-input",
    });

    const clearBtn = searchWrap.createEl("button", { text: "✕", cls: "mkd-search-clear" });
    clearBtn.style.display = "none";

    const cancelBtn = header.createEl("button", { text: "キャンセル", cls: "mkd-search-cancel" });
    cancelBtn.style.display = "none";

    // Suggestions dropdown
    this.suggestionsEl = this.rootEl.createDiv("mkd-suggestions");
    this.suggestionsEl.style.display = "none";

    // Events
    this.searchInput.addEventListener("input", async () => {
      const q = this.searchInput.value;
      this.searchQuery = q;
      clearBtn.style.display = q ? "flex" : "none";
      cancelBtn.style.display = q ? "block" : "none";
      if (!q) {
        this.suggestionsEl.style.display = "none";
        return;
      }
      const suggestions = await this.engine.suggest(q, this.dictionaries);
      this.renderSuggestions(suggestions);
    });

    this.searchInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        this.suggestionsEl.style.display = "none";
        await this.doSearch(this.searchInput.value);
      }
    });

    this.searchInput.addEventListener("focus", () => {
      header.addClass("mkd-search-focused");
    });

    this.searchInput.addEventListener("blur", () => {
      setTimeout(() => {
        header.removeClass("mkd-search-focused");
        this.suggestionsEl.style.display = "none";
      }, 200);
    });

    clearBtn.addEventListener("click", () => {
      this.searchInput.value = "";
      this.searchQuery = "";
      clearBtn.style.display = "none";
      cancelBtn.style.display = "none";
      this.searchResults = [];
      this.activeEntry = null;
      this.suggestionsEl.style.display = "none";
      this.renderCurrentTab();
    });

    cancelBtn.addEventListener("click", () => {
      this.searchInput.value = "";
      this.searchQuery = "";
      clearBtn.style.display = "none";
      cancelBtn.style.display = "none";
      this.searchResults = [];
      this.activeEntry = null;
      this.suggestionsEl.style.display = "none";
      this.renderCurrentTab();
    });
  }

  private renderSuggestions(suggestions: string[]): void {
    this.suggestionsEl.empty();
    if (!suggestions.length) { this.suggestionsEl.style.display = "none"; return; }
    this.suggestionsEl.style.display = "block";
    for (const s of suggestions) {
      const row = this.suggestionsEl.createDiv("mkd-suggestion-row");
      row.createEl("span", { text: "🔍", cls: "mkd-suggest-icon" });
      row.createEl("span", { text: s, cls: "mkd-suggest-text" });
      row.addEventListener("mousedown", async (e) => {
        e.preventDefault();
        this.searchInput.value = s;
        this.searchQuery = s;
        this.suggestionsEl.style.display = "none";
        await this.doSearch(s);
      });
    }
  }

  private async doSearch(query: string): Promise<void> {
    if (!query.trim()) return;
    await this.store.addHistory(query);
    this.history = await this.store.getHistory();
    this.searchResults = await this.engine.search(query, this.dictionaries);
    this.activeEntry = null;
    this.renderSearchResults();
  }

  private buildTabBar(): void {
    this.tabBar = this.rootEl.createDiv("mkd-tab-bar");
    const tabs: { id: Tab; icon: string; label: string }[] = [
      { id: "shelf", icon: "📚", label: "辞書棚" },
      { id: "bookmarks", icon: "🔖", label: "しおり" },
      { id: "history", icon: "🕐", label: "履歴" },
      { id: "more", icon: "⋯", label: "その他" },
    ];
    for (const tab of tabs) {
      const btn = this.tabBar.createDiv("mkd-tab-btn");
      btn.createEl("span", { text: tab.icon, cls: "mkd-tab-icon" });
      btn.createEl("span", { text: tab.label, cls: "mkd-tab-label" });
      if (tab.id === this.currentTab) btn.addClass("mkd-tab-active");
      btn.addEventListener("click", () => {
        this.currentTab = tab.id;
        this.activeEntry = null;
        this.searchResults = [];
        this.searchInput.value = "";
        this.searchQuery = "";
        this.updateTabActive();
        this.renderCurrentTab();
      });
    }
  }

  private updateTabActive(): void {
    for (let i = 0; i < this.tabBar.children.length; i++) {
      const child = this.tabBar.children[i] as HTMLElement;
      child.removeClass("mkd-tab-active");
    }
    const tabs: Tab[] = ["shelf", "bookmarks", "history", "more"];
    const idx = tabs.indexOf(this.currentTab);
    if (idx >= 0) (this.tabBar.children[idx] as HTMLElement).addClass("mkd-tab-active");
  }

  private renderCurrentTab(): void {
    this.mainContent.empty();
    if (this.activeEntry) {
      this.renderEntryDetail(this.activeEntry);
      return;
    }
    if (this.searchResults.length > 0 || this.searchQuery) {
      this.renderSearchResults();
      return;
    }
    switch (this.currentTab) {
      case "shelf": this.renderShelf(); break;
      case "bookmarks": this.renderBookmarks(); break;
      case "history": this.renderHistory(); break;
      case "more": this.renderMore(); break;
    }
  }

  private renderShelf(): void {
    const shelf = this.mainContent.createDiv("mkd-shelf");
    if (this.dictionaries.length === 0) {
      const empty = shelf.createDiv("mkd-empty");
      empty.createEl("p", { text: "辞書がまだインポートされていません。", cls: "mkd-empty-text" });
      const importBtn = shelf.createEl("button", { text: "＋ 辞書をインポート", cls: "mkd-import-btn" });
      importBtn.addEventListener("click", () => this.importDictionary());
      return;
    }
    shelf.createEl("p", { text: "辞書棚", cls: "mkd-section-title" });
    const grid = shelf.createDiv("mkd-dict-grid");
    for (const dict of this.dictionaries) {
      this.buildDictTile(grid, dict);
    }
    const importBtn = shelf.createEl("button", { text: "＋ 辞書を追加", cls: "mkd-add-dict-btn" });
    importBtn.addEventListener("click", () => this.importDictionary());
  }

  private buildDictTile(container: HTMLElement, dict: ImportedDictionary): void {
    const tile = container.createDiv("mkd-dict-tile");
    const color = this.getDictColor(dict.title);
    tile.style.setProperty("--dict-color", color);
    if (!dict.enabled) tile.addClass("mkd-dict-tile--disabled");

    const icon = tile.createDiv("mkd-dict-icon");
    icon.style.background = color;
    const initials = dict.title.slice(0, 2);
    icon.createEl("span", { text: initials, cls: "mkd-dict-initials" });

    tile.createEl("span", { text: dict.title, cls: "mkd-dict-name" });
    tile.createEl("span", { text: `${dict.entryCount.toLocaleString()}語`, cls: "mkd-dict-count" });

    tile.addEventListener("click", () => {
      this.selectedDictTitle = dict.title;
      this.searchInput.focus();
    });
  }

  private renderSearchResults(): void {
    const wrap = this.mainContent.createDiv("mkd-results-wrap");
    if (!this.searchResults.length) {
      wrap.createEl("p", { text: `「${this.searchQuery}」の検索結果がありません。`, cls: "mkd-empty-text" });
      return;
    }
    for (const group of this.searchResults) {
      const color = this.getDictColor(group.dictionaryTitle);
      const section = wrap.createDiv("mkd-result-section");
      const badge = section.createEl("span", { text: group.dictionaryTitle, cls: "mkd-dict-badge" });
      badge.style.background = color;

      for (const entry of group.entries) {
        const card = section.createDiv("mkd-result-card");
        const mainRow = card.createDiv("mkd-result-main");
        mainRow.createEl("span", { text: entry.expression, cls: "mkd-result-headword" });
        if (entry.reading && entry.reading !== entry.expression) {
          mainRow.createEl("span", { text: entry.reading, cls: "mkd-result-reading" });
        }
        const defPreview = this.getDefPreview(entry);
        if (defPreview) {
          card.createEl("p", { text: defPreview, cls: "mkd-result-def-preview" });
        }
        card.addEventListener("click", () => {
          this.activeEntry = entry;
          this.renderEntryDetail(entry);
        });
      }
    }
  }

  private renderEntryDetail(entry: YomitanEntry): void {
    this.mainContent.empty();
    const detail = this.mainContent.createDiv("mkd-entry-detail");

    // Back button + dict badge
    const topBar = detail.createDiv("mkd-entry-top-bar");
    const backBtn = topBar.createEl("button", { text: "‹ 戻る", cls: "mkd-back-btn" });
    backBtn.addEventListener("click", () => {
      this.activeEntry = null;
      this.renderSearchResults();
    });
    const badge = topBar.createEl("span", { text: entry.dictionaryTitle, cls: "mkd-dict-badge" });
    badge.style.background = this.getDictColor(entry.dictionaryTitle);

    // Bookmark button
    const bmBtn = topBar.createEl("button", { text: "🔖", cls: "mkd-bookmark-btn" });
    const isBookmarked = this.bookmarks.some(b => b.expression === entry.expression && b.dictionaryTitle === entry.dictionaryTitle);
    if (isBookmarked) bmBtn.addClass("mkd-bookmarked");
    bmBtn.addEventListener("click", async () => {
      if (isBookmarked) {
        const bm = this.bookmarks.find(b => b.expression === entry.expression && b.dictionaryTitle === entry.dictionaryTitle);
        if (bm) { await this.store.removeBookmark(bm.id); }
      } else {
        const bm: DictionaryBookmark = {
          id: `${entry.dictionaryTitle}-${entry.expression}-${Date.now()}`,
          expression: entry.expression,
          reading: entry.reading,
          dictionaryTitle: entry.dictionaryTitle,
          savedAt: Date.now(),
          folder: "default",
        };
        await this.store.addBookmark(bm);
      }
      this.bookmarks = await this.store.getBookmarks();
      new Notice(isBookmarked ? "しおりを削除しました" : "しおりに追加しました");
    });

    // Font size controls
    const fontCtrl = topBar.createDiv("mkd-font-ctrl");
    const smallBtn = fontCtrl.createEl("button", { text: "A⁻", cls: "mkd-font-btn" });
    const bigBtn = fontCtrl.createEl("button", { text: "A⁺", cls: "mkd-font-btn" });
    smallBtn.addEventListener("click", () => { this.fontSize = Math.max(11, this.fontSize - 1); this.updateFontSize(entryBody); });
    bigBtn.addEventListener("click", () => { this.fontSize = Math.min(24, this.fontSize + 1); this.updateFontSize(entryBody); });

    // Entry body
    const entryBody = detail.createDiv("mkd-entry-body");
    this.updateFontSize(entryBody);
    renderEntry(entry, entryBody, (term) => this.doSearch(term));
  }

  private updateFontSize(el: HTMLElement): void {
    el.style.fontSize = `${this.fontSize}px`;
  }

  private renderBookmarks(): void {
    const wrap = this.mainContent.createDiv("mkd-bookmarks-wrap");
    wrap.createEl("h3", { text: "しおり", cls: "mkd-section-title" });
    if (!this.bookmarks.length) {
      wrap.createEl("p", { text: "しおりがありません。", cls: "mkd-empty-text" });
      return;
    }
    const list = wrap.createEl("ul", { cls: "mkd-bookmark-list" });
    for (const bm of this.bookmarks.sort((a, b) => b.savedAt - a.savedAt)) {
      const item = list.createEl("li", { cls: "mkd-bookmark-item" });
      const left = item.createDiv("mkd-bm-left");
      left.createEl("span", { text: bm.expression, cls: "mkd-bm-word" });
      if (bm.reading && bm.reading !== bm.expression) {
        left.createEl("span", { text: bm.reading, cls: "mkd-bm-reading" });
      }
      const badge = item.createEl("span", { text: bm.dictionaryTitle, cls: "mkd-dict-badge mkd-dict-badge--sm" });
      badge.style.background = this.getDictColor(bm.dictionaryTitle);
      const removeBtn = item.createEl("button", { text: "×", cls: "mkd-bm-remove" });
      removeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.store.removeBookmark(bm.id);
        this.bookmarks = await this.store.getBookmarks();
        this.renderCurrentTab();
      });
      item.addEventListener("click", async () => {
        this.searchInput.value = bm.expression;
        this.searchQuery = bm.expression;
        await this.doSearch(bm.expression);
      });
    }
  }

  private renderHistory(): void {
    const wrap = this.mainContent.createDiv("mkd-history-wrap");
    const titleRow = wrap.createDiv("mkd-history-header");
    titleRow.createEl("h3", { text: "履歴", cls: "mkd-section-title" });
    if (this.history.length) {
      const clearBtn = titleRow.createEl("button", { text: "クリア", cls: "mkd-clear-history-btn" });
      clearBtn.addEventListener("click", async () => {
        await this.store.clearHistory();
        this.history = [];
        this.renderCurrentTab();
      });
    }
    if (!this.history.length) {
      wrap.createEl("p", { text: "検索履歴がありません。", cls: "mkd-empty-text" });
      return;
    }
    const list = wrap.createEl("ul", { cls: "mkd-history-list" });
    for (const item of this.history) {
      const li = list.createEl("li", { cls: "mkd-history-item" });
      li.createEl("span", { text: "🕐", cls: "mkd-hist-icon" });
      li.createEl("span", { text: item.query, cls: "mkd-hist-query" });
      const date = new Date(item.timestamp);
      li.createEl("span", { text: `${date.getMonth()+1}/${date.getDate()}`, cls: "mkd-hist-date" });
      li.addEventListener("click", async () => {
        this.searchInput.value = item.query;
        this.searchQuery = item.query;
        await this.doSearch(item.query);
      });
    }
  }

  private renderMore(): void {
    const wrap = this.mainContent.createDiv("mkd-more-wrap");
    wrap.createEl("h3", { text: "その他", cls: "mkd-section-title" });

    // Font size
    const fsRow = wrap.createDiv("mkd-more-row");
    fsRow.createEl("span", { text: "文字サイズ", cls: "mkd-more-label" });
    const fsCtrl = fsRow.createDiv("mkd-font-slider-wrap");
    const fsSlider = fsCtrl.createEl("input", { type: "range", cls: "mkd-font-slider" }) as HTMLInputElement;
    fsSlider.min = "11"; fsSlider.max = "24"; fsSlider.value = String(this.fontSize);
    const fsDisplay = fsCtrl.createEl("span", { text: `${this.fontSize}px`, cls: "mkd-font-display" });
    fsSlider.addEventListener("input", () => {
      this.fontSize = parseInt(fsSlider.value);
      fsDisplay.textContent = `${this.fontSize}px`;
    });

    // Manage dictionaries
    const manageRow = wrap.createDiv("mkd-more-row");
    manageRow.createEl("span", { text: "辞書の管理", cls: "mkd-more-label" });
    const importBtn2 = manageRow.createEl("button", { text: "＋ インポート", cls: "mkd-import-btn" });
    importBtn2.addEventListener("click", () => this.importDictionary());

    if (this.dictionaries.length) {
      const dictList = wrap.createEl("ul", { cls: "mkd-manage-dict-list" });
      for (const dict of this.dictionaries) {
        const li = dictList.createEl("li", { cls: "mkd-manage-dict-item" });
        const color = this.getDictColor(dict.title);
        const dot = li.createEl("span", { cls: "mkd-manage-dot" });
        dot.style.background = color;
        li.createEl("span", { text: dict.title, cls: "mkd-manage-dict-title" });
        li.createEl("span", { text: `${dict.entryCount.toLocaleString()}語`, cls: "mkd-manage-dict-count" });
        const toggle = li.createEl("input", { type: "checkbox", cls: "mkd-manage-toggle" }) as HTMLInputElement;
        toggle.checked = dict.enabled;
        toggle.addEventListener("change", async () => {
          dict.enabled = toggle.checked;
          this.dictionaries = this.dictionaries.map(d => d.id === dict.id ? dict : d);
          await this.store.updateDictionary(dict);
        });
        const delBtn = li.createEl("button", { text: "削除", cls: "mkd-manage-delete" });
        delBtn.addEventListener("click", async () => {
          await this.store.deleteDictionary(dict.id);
          this.dictionaries = await this.store.getDictionaries();
          this.renderCurrentTab();
        });
      }
    }
  }

  private getDictColor(title: string): string {
    for (const [key, color] of Object.entries(DICTIONARY_COLORS)) {
      if (title.includes(key)) return color;
    }
    return DEFAULT_DICTIONARY_COLOR;
  }

  private getDefPreview(entry: YomitanEntry): string {
    const first = entry.definitions[0];
    if (!first) return "";
    if (typeof first === "string") return first.slice(0, 80);
    return "";
  }

  async importDictionary(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      new Notice("辞書をインポート中…");
      try {
        const { meta, entries } = await YomitanDictionary.importFromZip(
          file,
          (msg) => new Notice(msg, 2000)
        );
        await this.store.addDictionary(meta, entries);
        this.dictionaries = await this.store.getDictionaries();
        new Notice(`「${meta.title}」のインポート完了 (${meta.entryCount.toLocaleString()}語)`);
        this.renderCurrentTab();
      } catch (err) {
        new Notice(`インポートエラー: ${err}`);
      }
    };
    input.click();
  }
}
