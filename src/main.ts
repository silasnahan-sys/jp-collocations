import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import type {
  PluginSettings,
  DiscourseContext,
  DiscourseCategory,
  SurferCollocationEntry,
  CollocationMatch,
} from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";
import { CollocationStore } from "./data/CollocationStore.ts";
import { DiscourseStore } from "./data/DiscourseStore.ts";
import { SearchEngine } from "./search/SearchEngine.ts";
import { HyogenScraper } from "./scraper/HyogenScraper.ts";
import { CollocationView, JP_COLLOCATIONS_VIEW_TYPE } from "./ui/CollocationView.ts";
import { SearchModal } from "./ui/SearchModal.ts";
import { AddEntryModal } from "./ui/AddEntryModal.ts";
import { SettingsTab } from "./ui/SettingsTab.ts";
import { TextClassifier } from "./classifier/TextClassifier.ts";
import { ClassifyModal } from "./ui/ClassifyModal.ts";
import { DiscourseStatsView, DISCOURSE_STATS_VIEW_TYPE } from "./ui/DiscourseStatsView.ts";

export default class JPCollocationsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  store!: CollocationStore;
  discourseStore!: DiscourseStore;
  engine!: SearchEngine;
  private scraper: HyogenScraper | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Data store
    const dataPath = `${this.app.vault.configDir}/plugins/jp-collocations/${this.settings.dataFilePath}`;
    this.store = new CollocationStore(this.app, dataPath);
    await this.store.load();

    // Discourse store
    const discourseIndexPath = `${this.app.vault.configDir}/plugins/jp-collocations/${this.settings.discourseIndexPath}`;
    this.discourseStore = new DiscourseStore(
      this.app,
      this.store,
      discourseIndexPath,
      this.settings.maxContextsPerCollocation
    );
    await this.discourseStore.load();
    this.discourseStore.rebuildIndex();

    // Search engine
    this.engine = new SearchEngine(this.store);

    // Register views
    this.registerView(JP_COLLOCATIONS_VIEW_TYPE, leaf =>
      new CollocationView(leaf, this.store, this.engine, this.settings, this.discourseStore)
    );
    this.registerView(DISCOURSE_STATS_VIEW_TYPE, leaf =>
      new DiscourseStatsView(leaf, this.discourseStore, this.store)
    );

    // Settings tab
    this.addSettingTab(new SettingsTab(
      this.app,
      this,
      this.settings,
      this.store,
      () => this.scraper,
      async () => { await this.saveSettings(); }
    ));

    // Commands
    this.addCommand({
      id: "open-lexicon",
      name: "Open Lexicon",
      callback: () => this.openLexiconView(),
    });

    this.addCommand({
      id: "search",
      name: "Search",
      hotkeys: [],
      callback: () => new SearchModal(this.app, this.engine).open(),
    });

    this.addCommand({
      id: "add-entry",
      name: "Add Entry",
      callback: () => new AddEntryModal(this.app, this.store, () => this.refreshViews()).open(),
    });

    this.addCommand({
      id: "classify-selected",
      name: "Classify Selected Text",
      editorCallback: (editor) => {
        const selected = editor.getSelection();
        if (!selected || selected.trim().length === 0) {
          new Notice("Select some Japanese text first!");
          return;
        }
        const classifier = new TextClassifier();
        const result = classifier.classify(selected.trim());
        new ClassifyModal(this.app, result, this.store, () => this.refreshViews()).open();
      },
    });

    this.addCommand({
      id: "import-data",
      name: "Import Data",
      callback: () => this.importData(),
    });

    this.addCommand({
      id: "export-data",
      name: "Export Data",
      callback: () => this.exportData(),
    });

    this.addCommand({
      id: "fetch-hyogen",
      name: "Fetch from Hyogen",
      callback: () => this.fetchFromHyogen(),
    });

    this.addCommand({
      id: "open-discourse-stats",
      name: "Open Discourse Stats",
      callback: () => this.openDiscourseStatsView(),
    });

    // Ribbon icon
    this.addRibbonIcon("languages", "JP Collocations", () => this.openLexiconView());
  }

  async onunload(): Promise<void> {
    this.scraper?.abort();
    this.app.workspace.detachLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async openLexiconView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: JP_COLLOCATIONS_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE)) {
      (leaf.view as CollocationView).refresh();
    }
  }

  private importData(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        const count = this.store.bulkImport(parsed);
        new Notice(`Imported ${count} entries.`);
        this.refreshViews();
      } catch {
        new Notice("Failed to parse JSON file.");
      }
    };
    input.click();
  }

  private exportData(): void {
    const data = JSON.stringify(this.store.exportAll(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jp-collocations-export.json";
    a.click();
    URL.revokeObjectURL(url);
    new Notice("Exported collocations.");
  }

  private async fetchFromHyogen(): Promise<void> {
    if (!this.settings.hyogenEnabled) {
      new Notice("Hyogen scraping is disabled. Enable it in settings first.");
      return;
    }
    if (this.settings.hyogenWordList.length === 0) {
      new Notice("No words configured. Add words to the scrape list in settings.");
      return;
    }
    if (this.scraper?.isRunning()) {
      new Notice("Scraper is already running.");
      return;
    }
    this.scraper = new HyogenScraper(this.app, this.store, {
      rateLimit: this.settings.hyogenRateLimit,
      onProgress: msg => new Notice(msg, 3000),
      onEntry: () => this.refreshViews(),
    });
    this.scraper.enqueue(this.settings.hyogenWordList);
    new Notice(`Starting Hyogen scrape for ${this.settings.hyogenWordList.length} words...`);
    const count = await this.scraper.run();
    new Notice(`Hyogen scrape complete. Added ${count} new entries.`);
    this.refreshViews();
  }

  private async openDiscourseStatsView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DISCOURSE_STATS_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: DISCOURSE_STATS_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  // ── Bridge API (called by jp-sentence-surfer) ─────────────────────────────

  /**
   * Creates a new collocation entry from surfer data, or merges discourse
   * contexts into an existing entry with the same expression.
   * Returns the ID of the created/updated entry.
   */
  async addEntryFromSurfer(entry: SurferCollocationEntry): Promise<string> {
    return this.discourseStore.addEntryFromSurfer(
      entry,
      this.settings.maxContextsPerCollocation
    );
  }

  /**
   * Attaches a discourse context to an existing collocation entry.
   * Deduplicates on chunkText + source.file.
   */
  async addDiscourseContext(collocationId: string, context: DiscourseContext): Promise<void> {
    await this.discourseStore.addContext(
      collocationId,
      context,
      this.settings.maxContextsPerCollocation
    );
  }

  /**
   * Adds an example sentence to an existing collocation entry,
   * storing source metadata and skipping exact duplicates.
   */
  async saveExampleSentence(
    collocationId: string,
    sentence: string,
    source: { file: string; timestamp?: string; url?: string }
  ): Promise<void> {
    await this.discourseStore.saveExampleSentence(collocationId, sentence, source);
  }

  /**
   * Scans all stored collocations against the given text and returns
   * matches with character positions. Designed to be fast — called on
   * every chunk capture during surfing.
   */
  findCollocationsInText(text: string): CollocationMatch[] {
    const matches: CollocationMatch[] = [];
    const all = this.store.getAll();
    for (const entry of all) {
      const expressions = [entry.fullPhrase, entry.headword].filter(Boolean);
      for (const expr of expressions) {
        let start = 0;
        while (start <= text.length - expr.length) {
          const idx = text.indexOf(expr, start);
          if (idx === -1) break;
          matches.push({
            collocationId: entry.id,
            expression: expr,
            matchStart: idx,
            matchEnd: idx + expr.length,
          });
          start = idx + 1;
        }
      }
    }
    // Sort by position
    matches.sort((a, b) => a.matchStart - b.matchStart);
    return matches;
  }

  /**
   * Returns all collocations that have been seen in chunks containing
   * the given discourse marker surface text.
   */
  searchByDiscourseMarker(markerSurface: string): SurferCollocationEntry[] {
    return this.discourseStore.getEntriesByMarker(markerSurface);
  }

  /**
   * Returns all collocations whose stored discourse contexts include the
   * given category.
   */
  searchByCategory(category: DiscourseCategory): SurferCollocationEntry[] {
    return this.discourseStore.getEntriesByCategory(category);
  }

  /**
   * Returns all stored collocation entries in SurferCollocationEntry format
   * for cross-referencing.
   */
  getAllEntries(): SurferCollocationEntry[] {
    return this.discourseStore.getAllEntries();
  }

  /**
   * Returns frequency statistics about stored discourse contexts.
   */
  getDiscourseStats(): {
    markerFrequency: Record<string, number>;
    categoryBreakdown: Record<DiscourseCategory, number>;
    totalContexts: number;
  } {
    return this.discourseStore.getStats();
  }
}
