import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import type { PluginSettings } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";
import { CollocationStore } from "./data/CollocationStore.ts";
import { SearchEngine } from "./search/SearchEngine.ts";
import { HyogenScraper } from "./scraper/HyogenScraper.ts";
import { CollocationView, JP_COLLOCATIONS_VIEW_TYPE } from "./ui/CollocationView.ts";
import { SearchModal } from "./ui/SearchModal.ts";
import { AddEntryModal } from "./ui/AddEntryModal.ts";
import { SettingsTab } from "./ui/SettingsTab.ts";
import { TextClassifier } from "./classifier/TextClassifier.ts";
import { ClassifyModal } from "./ui/ClassifyModal.ts";
import { DictionaryView, DICTIONARY_VIEW_TYPE } from "./ui/DictionaryView.ts";
import { DiscourseView, DISCOURSE_VIEW_TYPE } from "./ui/DiscourseView.ts";
import { SurferBridge } from "./surfer-bridge.ts";
import type {
  SurferCollocationEntry,
  DiscourseContext,
  CollocationMatch,
  DiscourseCategory,
  DiscourseStats,
} from "./surfer-types.ts";

export default class JPCollocationsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  store!: CollocationStore;
  engine!: SearchEngine;
  surferBridge!: SurferBridge;
  private scraper: HyogenScraper | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Surfer bridge — restore persisted entries
    this.surferBridge = new SurferBridge(this);
    const rawData = await this.loadData() as { _surferEntries?: SurferCollocationEntry[] } | null;
    const storedEntries: SurferCollocationEntry[] = Array.isArray(rawData?._surferEntries)
      ? rawData._surferEntries as SurferCollocationEntry[]
      : [];
    this.surferBridge.load(storedEntries);

    // Data store
    const dataPath = `${this.app.vault.configDir}/plugins/jp-collocations/${this.settings.dataFilePath}`;
    this.store = new CollocationStore(this.app, dataPath);
    await this.store.load();

    // Search engine
    this.engine = new SearchEngine(this.store);

    // Register views
    this.registerView(JP_COLLOCATIONS_VIEW_TYPE, leaf =>
      new CollocationView(leaf, this.store, this.engine, this.settings)
    );

    this.registerView(DICTIONARY_VIEW_TYPE, leaf =>
      new DictionaryView(leaf, this.app)
    );

    this.registerView(DISCOURSE_VIEW_TYPE, leaf =>
      new DiscourseView(leaf, this.store)
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
      id: "open-discourse-view",
      name: "Open Discourse Analysis",
      callback: () => this.openDiscourseView(),
    });

    this.addCommand({
      id: "open-dictionary",
      name: "Open Dictionary",
      callback: () => this.openDictionaryView(),
    });

    this.addCommand({
      id: "import-yomitan-dictionary",
      name: "Import Yomitan Dictionary",
      callback: () => this.importYomitanDictionary(),
    });

    this.addCommand({
      id: "fetch-hyogen",
      name: "Fetch from Hyogen",
      callback: () => this.fetchFromHyogen(),
    });

    // Ribbon icon
    this.addRibbonIcon("languages", "JP Collocations", () => this.openLexiconView());
  }

  async onunload(): Promise<void> {
    this.scraper?.abort();
    this.app.workspace.detachLeavesOfType(JP_COLLOCATIONS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DICTIONARY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(DISCOURSE_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData({
      ...this.settings,
      _surferEntries: [...this.surferBridge.getAllEntriesMap().values()],
    });
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

  private async openDictionaryView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: DICTIONARY_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  private async importYomitanDictionary(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE);
    if (leaves.length === 0) {
      await this.openDictionaryView();
    }
    const leaf = this.app.workspace.getLeavesOfType(DICTIONARY_VIEW_TYPE)[0];
    if (leaf?.view instanceof DictionaryView) {
      (leaf.view as DictionaryView).importDictionary();
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

  private async openDiscourseView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DISCOURSE_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: DISCOURSE_VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  // === Surfer Bridge API ===
  // Called by jp-sentence-surfer- via app.plugins.plugins['jp-collocations']

  async addEntryFromSurfer(entry: SurferCollocationEntry): Promise<void> {
    return this.surferBridge.addEntryFromSurfer(entry);
  }

  async addDiscourseContext(collocationId: string, context: DiscourseContext): Promise<void> {
    return this.surferBridge.addDiscourseContext(collocationId, context);
  }

  async saveExampleSentence(collocationId: string, sentence: string, source: string): Promise<void> {
    return this.surferBridge.saveExampleSentence(collocationId, sentence, source);
  }

  findCollocationsInText(text: string): CollocationMatch[] {
    return this.surferBridge.findCollocationsInText(text);
  }

  searchByDiscourseMarker(surface: string): SurferCollocationEntry[] {
    return this.surferBridge.searchByDiscourseMarker(surface);
  }

  searchByCategory(category: DiscourseCategory): SurferCollocationEntry[] {
    return this.surferBridge.searchByCategory(category);
  }

  getAllEntries(): SurferCollocationEntry[] {
    return this.surferBridge.getAllEntries();
  }

  getDiscourseStats(): DiscourseStats {
    return this.surferBridge.getDiscourseStats();
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
}
