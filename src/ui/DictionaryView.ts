// ─── Dictionary View ─────────────────────────────────────────────────────────
// Main Monokakido 辞書-style view for the Obsidian Yomitan dictionary integration.
// Provides: 辞書棚 | しおり | 履歴 | その他

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type { App } from "obsidian";
import { YomitanStore } from "../yomitan/YomitanStore.ts";
import { YomitanDictionary } from "../yomitan/YomitanDictionary.ts";
import { YomitanSearchEngine } from "../yomitan/YomitanSearchEngine.ts";
import { DictionarySearchBar } from "./DictionarySearchBar.ts";
import { DictionaryTabBar } from "./DictionaryTabBar.ts";
import { DictionaryCollectionGrid } from "./DictionaryCollectionGrid.ts";
import { DictionaryEntryRenderer } from "./DictionaryEntryRenderer.ts";
import { BookmarkManager } from "./BookmarkManager.ts";
import { HistoryPanel } from "./HistoryPanel.ts";
import type { TermEntry, YomitanSearchResult } from "../yomitan/types.ts";
import type { TabId } from "./DictionaryTabBar.ts";
import type { SearchMode } from "../yomitan/types.ts";

export const DICTIONARY_VIEW_TYPE = "mkd-dictionary-view";

export class DictionaryView extends ItemView {
  private store: YomitanStore;
  private engine: YomitanSearchEngine;
  private bookmarks: BookmarkManager;
  private history: HistoryPanel;

  // UI components
  private searchBar!: DictionarySearchBar;
  private tabBar!: DictionaryTabBar;
  private grid!: DictionaryCollectionGrid;
  private renderer!: DictionaryEntryRenderer;

  // Panel containers
  private shelfPanel!: HTMLElement;
  private resultsPanel!: HTMLElement;
  private bookmarksPanel!: HTMLElement;
  private historyPanel!: HTMLElement;
  private settingsPanel!: HTMLElement;

  private currentTab: TabId = "shelf";
  private lastQuery = "";

  constructor(leaf: WorkspaceLeaf, private readonly pluginApp: App) {
    super(leaf);
    this.store = new YomitanStore(pluginApp);
    this.engine = new YomitanSearchEngine(this.store);
    this.bookmarks = new BookmarkManager(pluginApp);
    this.history = new HistoryPanel(pluginApp);
  }

  getViewType(): string {
    return DICTIONARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "辞書";
  }

  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("mkd-view");

    await Promise.all([
      this.store.open(),
      this.bookmarks.load(),
      this.history.load(),
    ]);

    // ── Search bar ───────────────────────────────────────────────────────────
    const searchWrap = root.createDiv({ cls: "mkd-search-wrap" });
    this.searchBar = new DictionarySearchBar(searchWrap, (q, mode) =>
      this.handleSearch(q, mode),
    );

    // ── Main content area ────────────────────────────────────────────────────
    const content = root.createDiv({ cls: "mkd-content" });

    // Shelf panel (辞書棚 + search results)
    this.shelfPanel = content.createDiv({ cls: "mkd-panel mkd-panel--active" });
    this.grid = new DictionaryCollectionGrid(this.shelfPanel, dict => {
      // When a tile is clicked, search for common entries in that dictionary
      this.searchBar.setValue(dict.meta.jaTitle);
      this.handleSearch(dict.meta.jaTitle, "all", [dict.index.title]);
    });
    this.resultsPanel = this.shelfPanel.createDiv({ cls: "mkd-results-panel" });
    this.resultsPanel.style.display = "none";
    this.renderer = new DictionaryEntryRenderer();

    // Bookmarks panel
    this.bookmarksPanel = content.createDiv({ cls: "mkd-panel" });
    // History panel
    this.historyPanel = content.createDiv({ cls: "mkd-panel" });
    // Settings panel
    this.settingsPanel = content.createDiv({ cls: "mkd-panel" });
    this.buildSettingsPanel();

    // ── Tab bar (bottom) ─────────────────────────────────────────────────────
    this.tabBar = new DictionaryTabBar(root, (tab) => this.switchTab(tab));

    // Initial render
    this.grid.render(this.store.importedDictionaries);
  }

  async onClose(): Promise<void> {
    this.searchBar?.destroy();
    this.store.close();
  }

  // ── Tab switching ─────────────────────────────────────────────────────────

  private switchTab(tab: TabId): void {
    this.currentTab = tab;
    const panels: Record<TabId, HTMLElement> = {
      shelf: this.shelfPanel,
      bookmarks: this.bookmarksPanel,
      history: this.historyPanel,
      settings: this.settingsPanel,
    };
    for (const [id, panel] of Object.entries(panels)) {
      panel.toggleClass("mkd-panel--active", id === tab);
    }
    // Render panel content lazily
    if (tab === "bookmarks") {
      this.bookmarks.renderPanel(this.bookmarksPanel, entry => {
        this.switchTab("shelf");
        this.tabBar.select("shelf");
        this.showEntry(entry);
      });
    } else if (tab === "history") {
      this.history.renderPanel(this.historyPanel, query => {
        this.switchTab("shelf");
        this.tabBar.select("shelf");
        this.searchBar.setValue(query);
        this.handleSearch(query, "all");
      });
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────

  private async handleSearch(query: string, mode: SearchMode, dictionaries?: string[]): Promise<void> {
    this.lastQuery = query;

    if (!query.trim()) {
      this.resultsPanel.style.display = "none";
      this.shelfPanel.querySelector<HTMLElement>(".mkd-shelf")!.style.display = "";
      return;
    }

    this.history.push(query);

    // Show results panel, hide shelf grid
    this.resultsPanel.style.display = "";
    this.shelfPanel.querySelector<HTMLElement>(".mkd-shelf")!.style.display = "none";

    const results: YomitanSearchResult[] = await this.engine.search({
      query,
      mode,
      maxResults: 80,
      dictionaries,
    });

    this.renderer.renderResults(this.resultsPanel, results);

    // Add bookmark buttons to each entry card
    this.resultsPanel.querySelectorAll<HTMLElement>(".mkd-entry").forEach((card, i) => {
      const entry = results[i]?.entry;
      if (!entry) return;
      const bmBtn = card.createSpan({
        cls: `mkd-bookmark-btn${this.bookmarks.isBookmarked(entry) ? " mkd-bookmark-btn--active" : ""}`,
        text: this.bookmarks.isBookmarked(entry) ? "🔖" : "☆",
      });
      bmBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.bookmarks.isBookmarked(entry)) {
          const bm = this.bookmarks.findByEntry(entry);
          if (bm) this.bookmarks.remove(bm.id);
          bmBtn.setText("☆");
          bmBtn.removeClass("mkd-bookmark-btn--active");
        } else {
          this.bookmarks.add(entry);
          bmBtn.setText("🔖");
          bmBtn.addClass("mkd-bookmark-btn--active");
        }
      });
    });
  }

  private showEntry(entry: TermEntry): void {
    this.handleSearch(entry.term, "all");
    this.searchBar.setValue(entry.term);
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async importDictionary(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const notice = new Notice(`Importing ${file.name}…`, 0);
      try {
        const dict = new YomitanDictionary();
        await dict.loadFromFile(file);
        if (!dict.index) throw new Error("Invalid dictionary: missing index.json");
        await this.store.importDictionary(dict.index, dict.terms, dict.kanji);
        this.grid.render(this.store.importedDictionaries);
        new Notice(`✓ Imported "${dict.index.title}" (${dict.terms.length} terms)`);
      } catch (e) {
        new Notice(`✗ Import failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        notice.hide();
      }
    };
    input.click();
  }

  // ── Settings panel ────────────────────────────────────────────────────────

  private buildSettingsPanel(): void {
    const panel = this.settingsPanel;
    panel.createDiv({ cls: "mkd-settings-title", text: "その他" });

    // Import button
    const importRow = panel.createDiv({ cls: "mkd-settings-row" });
    importRow.createDiv({ cls: "mkd-settings-label", text: "Yomitan辞書をインポート" });
    const importBtn = importRow.createEl("button", {
      cls: "mkd-settings-btn",
      text: "Import .zip",
    });
    importBtn.addEventListener("click", () => this.importDictionary());

    // Installed dictionaries list
    panel.createDiv({ cls: "mkd-settings-section", text: "インストール済み辞書" });
    const dictList = panel.createDiv({ cls: "mkd-settings-dict-list" });
    this.refreshSettingsDictList(dictList);
  }

  private refreshSettingsDictList(container: HTMLElement): void {
    container.empty();
    const dicts = this.store.importedDictionaries;
    if (dicts.length === 0) {
      container.createDiv({ cls: "mkd-settings-empty", text: "辞書がありません" });
      return;
    }
    for (const dict of dicts) {
      const row = container.createDiv({ cls: "mkd-settings-dict-row" });
      const badge = row.createSpan({ cls: "mkd-dict-badge mkd-dict-badge--sm" });
      badge.style.setProperty("--mkd-badge-color", dict.meta.color);
      badge.setText(dict.meta.abbreviation);
      row.createSpan({ cls: "mkd-settings-dict-name", text: dict.meta.jaTitle });
      const del = row.createEl("button", { cls: "mkd-settings-del-btn", text: "削除" });
      del.addEventListener("click", async () => {
        await this.store.deleteDictionary(dict.index.title);
        this.grid.render(this.store.importedDictionaries);
        this.refreshSettingsDictList(container);
        new Notice(`Removed "${dict.index.title}"`);
      });
    }
  }
}
